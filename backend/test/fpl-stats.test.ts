import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { FplStatsStack } from '../lib/fpl-stats-stack';

function synth(): Template {
  const app = new cdk.App();
  const stack = new FplStatsStack(app, 'TestStack');
  return Template.fromStack(stack);
}

describe('SnapshotsBucket', () => {
  test('is versioned, encrypted, and blocks public access', () => {
    const template = synth();

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
    const template = synth();

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
    const template = synth();
    template.hasOutput('SnapshotsBucketName', {
      Export: { Name: 'TestStack-SnapshotsBucketName' },
    });
  });
});
