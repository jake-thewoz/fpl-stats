import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { BUNDLING_STACKS } from 'aws-cdk-lib/cx-api';
import {
  API_THROTTLE_BURST_LIMIT,
  API_THROTTLE_RATE_LIMIT,
  FplStatsStack,
  BOOTSTRAP_SNAPSHOT_EXPIRATION_DAYS,
  BOOTSTRAP_SNAPSHOT_PREFIX,
  SNAPSHOT_EXPIRATION_DAYS,
  XP_DAILY_RUN,
  XP_PRE_DEADLINE_RUN,
} from '../lib/fpl-stats-stack';
import { DEFAULT_MEMORY_MB } from '../lib/fpl-python-function';

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

  test.each([
    [BOOTSTRAP_SNAPSHOT_PREFIX, BOOTSTRAP_SNAPSHOT_EXPIRATION_DAYS],
    ['fpl/fixtures/', SNAPSHOT_EXPIRATION_DAYS],
  ])('tiers %s to Standard-IA at 30 days and expires it at %i', (prefix, days) => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            Prefix: prefix,
            Status: 'Enabled',
            ExpirationInDays: days,
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

  test('has no catch-all rule that would expire bootstrap snapshots early', () => {
    const buckets = template.findResources('AWS::S3::Bucket');
    const rules = Object.values(buckets).flatMap(
      (bucket) =>
        (bucket as { Properties?: { LifecycleConfiguration?: { Rules?: { Prefix?: string }[] } } })
          .Properties?.LifecycleConfiguration?.Rules ?? [],
    );
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((rule) => rule.Prefix)).toBe(true);
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
  const EXPECTED_FUNCTION_COUNT = 16;

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

describe('xP analyzer schedule', () => {
  test.each([
    ['early-morning', XP_DAILY_RUN],
    ['pre-deadline', XP_PRE_DEADLINE_RUN],
  ])('runs daily at the %s time', (_label, time) => {
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: `cron(${time.minute} ${time.hour} * * ? *)`,
      Targets: Match.arrayWith([
        Match.objectLike({
          Arn: { 'Fn::GetAtt': [Match.stringLikeRegexp('^AnalyzePlayerXpV2'), 'Arn'] },
        }),
      ]),
    });
  });
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

describe('Read API Lambdas', () => {
  const READ_API_DESCRIPTION_PREFIX = 'Read API';

  test('get at least the default memory, which sets their CPU share', () => {
    const functions = template.findResources('AWS::Lambda::Function', {
      Properties: { Description: Match.stringLikeRegexp(`^${READ_API_DESCRIPTION_PREFIX}`) },
    });
    expect(Object.keys(functions).length).toBeGreaterThan(0);
    for (const resource of Object.values(functions)) {
      expect(resource.Properties?.MemorySize).toBeGreaterThanOrEqual(DEFAULT_MEMORY_MB);
    }
  });
});
