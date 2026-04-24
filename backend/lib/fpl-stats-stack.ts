import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import {
  AttributeType,
  BillingMode,
  Table,
  TableEncryption,
} from 'aws-cdk-lib/aws-dynamodb';
import {
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction as LambdaTarget } from 'aws-cdk-lib/aws-events-targets';
import { Code, LayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  StorageClass,
} from 'aws-cdk-lib/aws-s3';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import { FplPythonFunction } from './fpl-python-function';

const ALERT_EMAIL = 'jake.thewoz@gmail.com';

export class FplStatsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const cacheTable = new Table(this, 'CacheTable', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // Native TTL — items with a numeric `ttl` attribute (unix seconds) are
      // eventually garbage-collected by DynamoDB. Items without it are
      // unaffected, so bootstrap/fixtures rows stay put.
      timeToLiveAttribute: 'ttl',
    });

    // Cold archive of raw FPL + external payloads. Written by ingest-style
    // Lambdas (Phase 3), read by analyzer Lambdas and Athena — never on the
    // request path. Lifecycle thresholds are conservative; revisit once we
    // see actual snapshot volume before the first prod deploy.
    const snapshotsBucket = new Bucket(this, 'SnapshotsBucket', {
      versioned: true,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          id: 'tier-and-expire',
          enabled: true,
          transitions: [
            {
              storageClass: StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
          expiration: cdk.Duration.days(90),
          noncurrentVersionExpiration: cdk.Duration.days(30),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
    });

    const fplSchemasLayer = new LayerVersion(this, 'FplSchemasLayer', {
      code: Code.fromAsset(
        path.join(__dirname, '..', 'layers', 'fpl_schemas'),
      ),
      compatibleRuntimes: [Runtime.PYTHON_3_12],
      description:
        'Shared pydantic schemas + SCHEMA_VERSION for cached FPL entities.',
    });

    const healthFn = new FplPythonFunction(this, 'Health', {
      name: 'health',
      description: 'Health-check Lambda — returns ok + current UTC time.',
      environment: {
        CACHE_TABLE_NAME: cacheTable.tableName,
      },
    });

    const ingestFn = new FplPythonFunction(this, 'IngestFpl', {
      name: 'ingest_fpl',
      description:
        'Scheduled ingestion — fetch FPL bootstrap-static + fixtures, cache to DDB.',
      environment: {
        CACHE_TABLE_NAME: cacheTable.tableName,
      },
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      layers: [fplSchemasLayer],
    });
    cacheTable.grantReadWriteData(ingestFn);

    const gameweekCurrentFn = new FplPythonFunction(this, 'GameweekCurrent', {
      name: 'gameweek_current',
      description: 'Read API — returns current gameweek + its fixtures.',
      environment: {
        CACHE_TABLE_NAME: cacheTable.tableName,
      },
      layers: [fplSchemasLayer],
    });
    cacheTable.grantReadData(gameweekCurrentFn);

    const playersFn = new FplPythonFunction(this, 'Players', {
      name: 'players',
      description: 'Read API — returns a summarized player list, filterable by team/position.',
      environment: {
        CACHE_TABLE_NAME: cacheTable.tableName,
      },
      layers: [fplSchemasLayer],
    });
    cacheTable.grantReadData(playersFn);

    const entryFn = new FplPythonFunction(this, 'Entry', {
      name: 'entry',
      description: 'Read API — cache-aside GET /entry/{teamId} backed by FPL.',
      environment: {
        CACHE_TABLE_NAME: cacheTable.tableName,
        ENTRY_TTL_SECONDS: '1800',
      },
      timeout: cdk.Duration.seconds(15),
      layers: [fplSchemasLayer],
    });
    cacheTable.grantReadWriteData(entryFn);

    const entryGameweekFn = new FplPythonFunction(this, 'EntryGameweek', {
      name: 'entry_gameweek',
      description:
        'Read API — cache-aside GET /entry/{teamId}/gameweek/{gw} (picks + points).',
      environment: {
        CACHE_TABLE_NAME: cacheTable.tableName,
        PICKS_TTL_SECONDS: '1800',
      },
      timeout: cdk.Duration.seconds(15),
      layers: [fplSchemasLayer],
    });
    cacheTable.grantReadWriteData(entryGameweekFn);

    const gameweekLiveFn = new FplPythonFunction(this, 'GameweekLive', {
      name: 'gameweek_live',
      description:
        'Read API — cache-aside GET /gameweek/{gw}/live (per-player points + minutes).',
      environment: {
        CACHE_TABLE_NAME: cacheTable.tableName,
        GAMEWEEK_LIVE_TTL_SECONDS: '1800',
      },
      timeout: cdk.Duration.seconds(15),
      layers: [fplSchemasLayer],
    });
    cacheTable.grantReadWriteData(gameweekLiveFn);

    const leagueMembersFn = new FplPythonFunction(this, 'LeagueMembers', {
      name: 'league_members',
      description:
        'Read API — cache-aside GET /league/{leagueId}/members for classic-league import.',
      environment: {
        CACHE_TABLE_NAME: cacheTable.tableName,
        LEAGUE_TTL_SECONDS: '1800',
      },
      timeout: cdk.Duration.seconds(15),
      layers: [fplSchemasLayer],
    });
    cacheTable.grantReadWriteData(leagueMembersFn);

    new Rule(this, 'IngestSchedule', {
      description: 'Trigger FPL ingestion every 30 minutes.',
      schedule: Schedule.rate(cdk.Duration.minutes(30)),
      targets: [new LambdaTarget(ingestFn)],
    });

    const alertsTopic = new Topic(this, 'IngestionAlertsTopic', {
      displayName: 'FPL Stats ingestion alerts',
    });
    alertsTopic.addSubscription(new EmailSubscription(ALERT_EMAIL));

    const ingestErrorsAlarm = ingestFn
      .metricErrors({
        period: cdk.Duration.minutes(30),
        statistic: 'Sum',
      })
      .createAlarm(this, 'IngestFplErrorsAlarm', {
        alarmDescription:
          'FPL ingestion Lambda returned an error — cached data may be going stale.',
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      });
    ingestErrorsAlarm.addAlarmAction(new SnsAction(alertsTopic));

    const httpApi = new HttpApi(this, 'HttpApi', {
      description: 'FPL Stats public HTTP API.',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.OPTIONS],
        allowHeaders: ['*'],
      },
    });

    httpApi.addRoutes({
      path: '/health',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('HealthIntegration', healthFn),
    });

    httpApi.addRoutes({
      path: '/gameweek/current',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        'GameweekCurrentIntegration',
        gameweekCurrentFn,
      ),
    });

    httpApi.addRoutes({
      path: '/players',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        'PlayersIntegration',
        playersFn,
      ),
    });

    httpApi.addRoutes({
      path: '/entry/{teamId}',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('EntryIntegration', entryFn),
    });

    httpApi.addRoutes({
      path: '/entry/{teamId}/gameweek/{gw}',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        'EntryGameweekIntegration',
        entryGameweekFn,
      ),
    });

    httpApi.addRoutes({
      path: '/gameweek/{gw}/live',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        'GameweekLiveIntegration',
        gameweekLiveFn,
      ),
    });

    httpApi.addRoutes({
      path: '/league/{leagueId}/members',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        'LeagueMembersIntegration',
        leagueMembersFn,
      ),
    });

    new cdk.CfnOutput(this, 'CacheTableName', {
      value: cacheTable.tableName,
      description: 'DynamoDB cache table name',
      exportName: `${this.stackName}-CacheTableName`,
    });

    new cdk.CfnOutput(this, 'SnapshotsBucketName', {
      value: snapshotsBucket.bucketName,
      description: 'S3 bucket for raw FPL + external data snapshots',
      exportName: `${this.stackName}-SnapshotsBucketName`,
    });

    new cdk.CfnOutput(this, 'IngestFplFunctionName', {
      value: ingestFn.functionName,
      description: 'FPL ingestion Lambda function name',
      exportName: `${this.stackName}-IngestFplFunctionName`,
    });

    new cdk.CfnOutput(this, 'ApiBaseUrl', {
      value: httpApi.apiEndpoint,
      description: 'HTTP API base URL',
      exportName: `${this.stackName}-ApiBaseUrl`,
    });
  }
}
