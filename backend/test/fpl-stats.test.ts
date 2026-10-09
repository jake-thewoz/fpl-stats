import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { BUNDLING_STACKS } from 'aws-cdk-lib/cx-api';
import {
  API_THROTTLE_BURST_LIMIT,
  API_THROTTLE_RATE_LIMIT,
  FplStatsStack,
} from '../lib/fpl-stats-stack';

// Instantiating FplStatsStack would trigger Docker-based PythonFunction
// bundling for every Lambda — minutes of work, and impossible in any
// environment without a Docker daemon. An empty bundling-stacks list
// matches no stack, so the assets stage as placeholders instead. These
// tests assert on stack structure, never on bundled asset contents, so
// the placeholder is enough. `cdk synth` and `cdk deploy` still bundle
// for real.
const BUNDLE_NO_STACKS: string[] = [];

let template: Template;

beforeAll(() => {
  const app = new cdk.App({ context: { [BUNDLING_STACKS]: BUNDLE_NO_STACKS } });
  const stack = new FplStatsStack(app, 'TestStack');
  template = Template.fromStack(stack);
});

describe('SnapshotsBucket', () => {
  test('is versioned, encrypted, and blocks public access', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: { Status: 'Enabled' },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: Match.arrayWith([
          Match.objectLike({
            ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' },
          }),
        ]),
      },
    });
  });

  test('tiers to Standard-IA at 30 days and expires at 90', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            Status: 'Enabled',
            ExpirationInDays: 90,
            NoncurrentVersionExpiration: { NoncurrentDays: 30 },
            Transitions: Match.arrayWith([
              Match.objectLike({
                StorageClass: 'STANDARD_IA',
                TransitionInDays: 30,
              }),
            ]),
          }),
        ]),
      },
    });
  });

  test('exposes bucket name as a stack output', () => {
    template.hasOutput('SnapshotsBucketName', {
      Export: { Name: 'TestStack-SnapshotsBucketName' },
    });
  });
});

describe('Lambda log groups', () => {
  // Count has to match the number of FplPythonFunction instances declared in
  // FplStatsStack. Bump this when adding or removing a Lambda.
  const EXPECTED_FUNCTION_COUNT = 15;

  test('every FplPythonFunction has an explicit LogGroup with 1-week retention', () => {
    template.resourceCountIs('AWS::Logs::LogGroup', EXPECTED_FUNCTION_COUNT);
    const groups = template.findResources('AWS::Logs::LogGroup');
    for (const resource of Object.values(groups)) {
      expect(resource.Properties?.RetentionInDays).toBe(7);
    }
  });

  test('no deprecated Custom::LogRetention resources remain', () => {
    template.resourceCountIs('Custom::LogRetention', 0);
  });
});

describe('Ingestion alarms', () => {
  // Recurring-trigger alarms must require two consecutive evaluation
  // periods of errors before paging — a single transient FPL upstream
  // 403 / Lambda blip should not wake anyone. See PR adding 403 retry
  // for the noise pattern this guards against.
  const DEBOUNCED_ALARMS = [
    'IngestFplErrorsAlarm',
    'IngestClubeloErrorsAlarm',
    'AnalyzePlayerFormErrorsAlarm',
    'AnalyzePlayerXpV2ErrorsAlarm',
  ];

  test.each(DEBOUNCED_ALARMS)(
    '%s requires 2 consecutive periods to alarm',
    (logicalIdPrefix) => {
      const alarms = template.findResources('AWS::CloudWatch::Alarm', {
        Properties: { EvaluationPeriods: 2, DatapointsToAlarm: 2 },
      });
      const matching = Object.keys(alarms).filter((id) =>
        id.startsWith(logicalIdPrefix),
      );
      expect(matching.length).toBe(1);
    },
  );
});

describe('HttpApi', () => {
  test('throttles every route on the default stage', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      DefaultRouteSettings: {
        ThrottlingRateLimit: API_THROTTLE_RATE_LIMIT,
        ThrottlingBurstLimit: API_THROTTLE_BURST_LIMIT,
      },
    });
  });
});
