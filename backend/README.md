# FPL Stats — backend (CDK)

AWS CDK (TypeScript) app that defines the backend: API Gateway, Python Lambda handlers, DynamoDB, EventBridge, and (soon) S3. Lambda source lives under `lambdas/` and is bundled at deploy time.

## First-time AWS setup

One-time steps per AWS account/region before any `cdk deploy`.

### 1. Verify AWS CLI auth

```bash
aws sts get-caller-identity
```

Should print your account ID and IAM user/role. If this fails, run `aws configure` (or your SSO login flow) first.

### 2. (Recommended) Set us-east-1 as default region

```bash
aws configure set region us-east-1
```

This project targets `us-east-1`. Setting the default lets you drop `--region` from later AWS CLI calls.

### 3. Bootstrap CDK

CDK needs a support stack named `CDKToolkit` in each (account, region) combination before it can deploy anything. Bootstrap provisions an S3 bucket for asset staging, an ECR repo (for container images if needed), and a few IAM roles — free-tier friendly for our usage.

Use the account ID from step 1:

```bash
cd backend
npx cdk bootstrap aws://<your-account-id>/us-east-1
```

Takes about a minute. You should see `✅  Environment aws://<account>/us-east-1 bootstrapped.` at the end.

### 4. Verify the CDKToolkit stack exists

```bash
aws cloudformation describe-stacks \
  --stack-name CDKToolkit \
  --region us-east-1 \
  --query 'Stacks[0].StackStatus' \
  --output text
```

Should print `CREATE_COMPLETE`.

## Useful commands

- `npm run build` — compile TypeScript to JS
- `npm run watch` — compile on change
- `npm run test` — jest unit tests (CDK stack assertions)
- `npx cdk synth` — render CloudFormation locally (no deploy)
- `npx cdk diff` — diff deployed vs local
- `npx cdk deploy` — deploy (requires bootstrap; Docker must be running once we start using `PythonFunction` for Lambda bundling)

## Lambda handlers

Lambda handlers are Python, one directory per function under `backend/lambdas/<name>/`. See root `CLAUDE.md` for the full layout and per-Lambda dev commands.
