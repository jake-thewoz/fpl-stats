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
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction as LambdaTarget } from 'aws-cdk-lib/aws-events-targets';
import { Code, LayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { FplPythonFunction } from './fpl-python-function';

export class FplStatsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const cacheTable = new Table(this, 'CacheTable', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
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

    new Rule(this, 'IngestSchedule', {
      description: 'Trigger FPL ingestion every 30 minutes.',
      schedule: Schedule.rate(cdk.Duration.minutes(30)),
      targets: [new LambdaTarget(ingestFn)],
    });

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
