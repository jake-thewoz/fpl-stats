import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import { FplPythonFunction } from './fpl-python-function';

export class FplStatsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    new FplPythonFunction(this, 'Healthcheck', {
      name: 'healthcheck',
      description: 'Smoke-test Lambda that validates the Python build pattern.',
    });
  }
}
