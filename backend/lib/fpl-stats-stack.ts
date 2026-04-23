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

    new cdk.CfnOutput(this, 'CacheTableName', {
      value: cacheTable.tableName,
      description: 'DynamoDB cache table name',
      exportName: `${this.stackName}-CacheTableName`,
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
