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

    const healthFn = new FplPythonFunction(this, 'Health', {
      name: 'health',
      description: 'Health-check Lambda — returns ok + current UTC time.',
      environment: {
        CACHE_TABLE_NAME: cacheTable.tableName,
      },
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

    new cdk.CfnOutput(this, 'CacheTableName', {
      value: cacheTable.tableName,
      description: 'DynamoDB cache table name',
      exportName: `${this.stackName}-CacheTableName`,
    });

    new cdk.CfnOutput(this, 'ApiBaseUrl', {
      value: httpApi.apiEndpoint,
      description: 'HTTP API base URL',
      exportName: `${this.stackName}-ApiBaseUrl`,
    });
  }
}
