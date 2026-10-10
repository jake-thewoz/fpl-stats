import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import {
  PythonFunction,
  PythonFunctionProps,
} from '@aws-cdk/aws-lambda-python-alpha';
import { Construct } from 'constructs';

const LAMBDAS_ROOT = path.join(__dirname, '..', 'lambdas');

// Lambda CPU scales linearly with memory. At 128 MB the read handlers
// took 2–5 s warm for ~0.3 s of real work (#176); 1024 MB is what lets
// them parse the ~500 KB bootstrap item quickly.
export const DEFAULT_MEMORY_MB = 1024;

export interface FplPythonFunctionProps
  extends Omit<PythonFunctionProps, 'entry' | 'runtime'> {
  /** Directory name under `backend/lambdas/`. Resolves to the Lambda's entry path. */
  readonly name: string;
}

/**
 * PythonFunction with the defaults this project standardizes on:
 * Python 3.12, 1024MB memory, 10s timeout, 1-week log retention.
 * Any default can be overridden via props.
 */
export class FplPythonFunction extends PythonFunction {
  constructor(scope: Construct, id: string, props: FplPythonFunctionProps) {
    const { name, bundling, ...rest } = props;

    // Explicit LogGroup replaces the deprecated `logRetention` prop,
    // which spawns a custom-resource Lambda per stack solely to apply
    // retention after deploy. Declaring the group up-front keeps the
    // synthesized template free of that extra machinery.
    const logGroup = new LogGroup(scope, `${id}LogGroup`, {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    super(scope, id, {
      entry: path.join(LAMBDAS_ROOT, name),
      index: 'handler.py',
      handler: 'lambda_handler',
      runtime: Runtime.PYTHON_3_12,
      memorySize: DEFAULT_MEMORY_MB,
      timeout: cdk.Duration.seconds(10),
      logGroup,
      bundling: {
        assetExcludes: [
          'tests',
          'conftest.py',
          'requirements-dev.txt',
          'README.md',
          '.venv',
          '__pycache__',
          '.pytest_cache',
        ],
        ...bundling,
      },
      ...rest,
    });
  }
}
