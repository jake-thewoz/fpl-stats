import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { FplStatsStack } from '../lib/fpl-stats-stack';

// Instantiating FplStatsStack triggers Docker-based PythonFunction
// bundling for every Lambda — roughly 30 seconds. Do it once per file.
let template: Template;

beforeAll(() => {
  const app = new cdk.App();
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
  const EXPECTED_FUNCTION_COUNT = 13;

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
