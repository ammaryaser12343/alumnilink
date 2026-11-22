// Deploys the Search API to Floci (local AWS emulator) or to an AWS account.
// Creates, or updates if they already exist:
//   1. Secrets Manager secret  alumnilink/search   (DATABASE_URL, TOKEN_SECRET, SERVICE_KEY from .env)
//   2. DynamoDB table          alumnilink-search-ratelimit   (request counts, rows expire by TTL)
//   3. CloudWatch Logs group   /aws/lambda/alumnilink-search  (Lambda output and AUDIT lines, kept 14 days)
//   4. IAM role                alumnilink-search-role   (only the permissions above)
//   5. Lambda function         alumnilink-search  (this folder and ../shared, Node.js 22)
//   6. API Gateway HTTP API    alumnilink-search-api  (every request goes to the Lambda function)
//
// Usage (from search-api/, with Floci running and .env filled in):  npm run aws:deploy
require('dotenv').config();

process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_ENDPOINT_URL = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
// Floci accepts any credentials. For a real AWS account, set your own before running.
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const AdmZip = require('adm-zip');
const sm = require('@aws-sdk/client-secrets-manager');
const ddb = require('@aws-sdk/client-dynamodb');
const logs = require('@aws-sdk/client-cloudwatch-logs');
const iam = require('@aws-sdk/client-iam');
const lambda = require('@aws-sdk/client-lambda');
const apigw = require('@aws-sdk/client-apigatewayv2');
const { SECRET_KEYS } = require('../services/secrets');

const NAMES = {
  secret: 'alumnilink/search',
  table: 'alumnilink-search-ratelimit',
  role: 'alumnilink-search-role',
  fn: 'alumnilink-search',
  logGroup: '/aws/lambda/alumnilink-search',
  api: 'alumnilink-search-api'
};
const SEARCH_DIR = path.join(__dirname, '..');
const SHARED_DIR = path.join(SEARCH_DIR, '..', 'shared');

// Lambda runs inside Docker, so "localhost" there is the container itself.
// host.docker.internal reaches services running on your computer.
function forLambda(url) {
  return url ? url.replace(/\/\/(localhost|127\.0\.0\.1)(:|\/|$)/, '//host.docker.internal$2') : url;
}

const isNotFound = (error) => ['ResourceNotFoundException', 'NoSuchEntityException', 'NoSuchEntity', 'NotFoundException'].includes(error.name);
const isExisting = (error) => ['ResourceExistsException', 'ResourceInUseException', 'EntityAlreadyExistsException', 'EntityAlreadyExists', 'ResourceAlreadyExistsException', 'ResourceConflictException'].includes(error.name);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function deploySecret() {
  const client = new sm.SecretsManagerClient({});
  const values = {};
  for (const key of SECRET_KEYS) {
    if (!process.env[key]) throw new Error(`${key} is missing from .env`);
    values[key] = process.env[key];
  }
  const SecretString = JSON.stringify(values);
  try {
    await client.send(new sm.CreateSecretCommand({ Name: NAMES.secret, SecretString, Description: 'AlumniLink Search API secrets' }));
    console.log(`1. Secret ${NAMES.secret}: created`);
  } catch (error) {
    if (!isExisting(error)) throw error;
    await client.send(new sm.PutSecretValueCommand({ SecretId: NAMES.secret, SecretString }));
    console.log(`1. Secret ${NAMES.secret}: updated`);
  }
  const { ARN } = await client.send(new sm.DescribeSecretCommand({ SecretId: NAMES.secret }));
  return ARN;
}

async function deployTable() {
  const client = new ddb.DynamoDBClient({});
  try {
    await client.send(new ddb.CreateTableCommand({
      TableName: NAMES.table,
      AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
      BillingMode: 'PAY_PER_REQUEST'
    }));
    console.log(`2. DynamoDB table ${NAMES.table}: created`);
  } catch (error) {
    if (!isExisting(error)) throw error;
    console.log(`2. DynamoDB table ${NAMES.table}: already exists`);
  }
  try {
    await client.send(new ddb.UpdateTimeToLiveCommand({
      TableName: NAMES.table,
      TimeToLiveSpecification: { Enabled: true, AttributeName: 'expiresAt' }
    }));
  } catch (error) {
    // Already enabled is fine.
    if (!/already enabled|TimeToLive is already/i.test(error.message)) console.log(`   (TTL: ${error.message})`);
  }
  const { Table } = await client.send(new ddb.DescribeTableCommand({ TableName: NAMES.table }));
  return Table.TableArn;
}

async function deployLogGroup() {
  const client = new logs.CloudWatchLogsClient({});
  try {
    await client.send(new logs.CreateLogGroupCommand({ logGroupName: NAMES.logGroup }));
    console.log(`3. Log group ${NAMES.logGroup}: created`);
  } catch (error) {
    if (!isExisting(error)) throw error;
    console.log(`3. Log group ${NAMES.logGroup}: already exists`);
  }
  // Keep logs 14 days: enough for the course, and old personal data does not pile up.
  await client.send(new logs.PutRetentionPolicyCommand({ logGroupName: NAMES.logGroup, retentionInDays: 14 }));
}

async function deployRole(secretArn, tableArn) {
  const client = new iam.IAMClient({});
  const trust = {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }]
  };
  // Least privilege: read one secret, update one table, write its own logs.
  const policy = {
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: ['secretsmanager:GetSecretValue'], Resource: secretArn },
      { Effect: 'Allow', Action: ['dynamodb:UpdateItem'], Resource: tableArn },
      { Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: `arn:aws:logs:*:*:log-group:${NAMES.logGroup}:*` }
    ]
  };
  let roleArn;
  try {
    const { Role } = await client.send(new iam.CreateRoleCommand({ RoleName: NAMES.role, AssumeRolePolicyDocument: JSON.stringify(trust) }));
    roleArn = Role.Arn;
    console.log(`4. IAM role ${NAMES.role}: created`);
  } catch (error) {
    if (!isExisting(error)) throw error;
    const { Role } = await client.send(new iam.GetRoleCommand({ RoleName: NAMES.role }));
    roleArn = Role.Arn;
    console.log(`4. IAM role ${NAMES.role}: already exists`);
  }
  await client.send(new iam.PutRolePolicyCommand({ RoleName: NAMES.role, PolicyName: 'alumnilink-search-access', PolicyDocument: JSON.stringify(policy) }));
  return roleArn;
}

// Builds the Lambda zip: search-api (production packages only) and shared.
function buildZip() {
  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alumnilink-search-'));
  const target = path.join(buildDir, 'search-api');
  const skip = new Set(['node_modules', '.env', 'aws', 'scripts', 'requests.http']);
  fs.cpSync(SEARCH_DIR, target, { recursive: true, filter: (src) => !skip.has(path.basename(src)) || src === SEARCH_DIR });
  fs.cpSync(SHARED_DIR, path.join(buildDir, 'shared'), { recursive: true, filter: (src) => path.basename(src) !== 'scripts' });
  execSync('npm install --omit=dev --no-audit --no-fund --silent', { cwd: target, stdio: 'inherit', shell: true });

  const zip = new AdmZip();
  zip.addLocalFolder(target, 'search-api');
  zip.addLocalFolder(path.join(buildDir, 'shared'), 'shared');
  const bytes = zip.toBuffer();
  fs.rmSync(buildDir, { recursive: true, force: true });
  return bytes;
}

async function deployFunction(roleArn) {
  const client = new lambda.LambdaClient({});
  const ZipFile = buildZip();
  const Environment = {
    Variables: {
      NODE_ENV: 'production',
      SECRET_ID: NAMES.secret,
      RATE_LIMIT_TABLE: NAMES.table,
      RATE_LIMIT_PER_MINUTE: process.env.RATE_LIMIT_PER_MINUTE || '60',
      IDENTITY_API_URL: forLambda(process.env.IDENTITY_API_URL),
      PROFILE_API_URL: forLambda(process.env.PROFILE_API_URL),
      CORS_ORIGINS: process.env.CORS_ORIGINS || 'http://localhost:8080'
    }
  };
  if (process.env.GEOCODING_URL) Environment.Variables.GEOCODING_URL = forLambda(process.env.GEOCODING_URL);

  const settings = {
    FunctionName: NAMES.fn,
    Runtime: 'nodejs22.x',
    Handler: 'search-api/lambda.handler',
    Role: roleArn,
    Timeout: 15,
    MemorySize: 256,
    Environment
  };
  let arn;
  try {
    const created = await client.send(new lambda.CreateFunctionCommand({ ...settings, Code: { ZipFile } }));
    arn = created.FunctionArn;
    console.log(`5. Lambda ${NAMES.fn}: created (${Math.round(ZipFile.length / 1024)} KB)`);
  } catch (error) {
    if (!isExisting(error)) throw error;
    await client.send(new lambda.UpdateFunctionCodeCommand({ FunctionName: NAMES.fn, ZipFile }));
    await waitForUpdate(client);
    const updated = await client.send(new lambda.UpdateFunctionConfigurationCommand(settings));
    arn = updated.FunctionArn;
    console.log(`5. Lambda ${NAMES.fn}: updated (${Math.round(ZipFile.length / 1024)} KB)`);
  }
  await waitForUpdate(client);
  return arn;
}

async function waitForUpdate(client) {
  for (let i = 0; i < 30; i += 1) {
    const config = await client.send(new lambda.GetFunctionConfigurationCommand({ FunctionName: NAMES.fn }));
    if (config.State !== 'Pending' && config.LastUpdateStatus !== 'InProgress') return;
    await wait(1000);
  }
}

async function deployApi(functionArn) {
  const client = new apigw.ApiGatewayV2Client({});
  const { Items = [] } = await client.send(new apigw.GetApisCommand({}));
  let api = Items.find((item) => item.Name === NAMES.api);
  if (api) {
    console.log(`6. API Gateway ${NAMES.api}: already exists`);
  } else {
    api = await client.send(new apigw.CreateApiCommand({ Name: NAMES.api, ProtocolType: 'HTTP' }));
    console.log(`6. API Gateway ${NAMES.api}: created`);
  }
  const ApiId = api.ApiId;

  // Lambda proxy integration: API Gateway passes the whole request to the function.
  const { Items: integrations = [] } = await client.send(new apigw.GetIntegrationsCommand({ ApiId }));
  let integration = integrations.find((item) => item.IntegrationUri === functionArn);
  if (!integration) {
    integration = await client.send(new apigw.CreateIntegrationCommand({
      ApiId,
      IntegrationType: 'AWS_PROXY',
      IntegrationUri: functionArn,
      PayloadFormatVersion: '2.0'
    }));
  }

  // $default route: every method and path goes to the function; Express does the routing.
  const { Items: routes = [] } = await client.send(new apigw.GetRoutesCommand({ ApiId }));
  if (!routes.some((route) => route.RouteKey === '$default')) {
    await client.send(new apigw.CreateRouteCommand({ ApiId, RouteKey: '$default', Target: `integrations/${integration.IntegrationId}` }));
  }

  // $default stage with auto-deploy, so the URL has no stage name in it.
  const { Items: stages = [] } = await client.send(new apigw.GetStagesCommand({ ApiId }));
  if (!stages.some((stage) => stage.StageName === '$default')) {
    await client.send(new apigw.CreateStageCommand({ ApiId, StageName: '$default', AutoDeploy: true }));
  }
  console.log('   route $default -> Lambda (payload 2.0), stage $default');

  // Let API Gateway call the function (Floci does not check this; AWS does).
  const lambdaClient = new lambda.LambdaClient({});
  try {
    await lambdaClient.send(new lambda.AddPermissionCommand({
      FunctionName: NAMES.fn,
      StatementId: 'allow-api-gateway',
      Action: 'lambda:InvokeFunction',
      Principal: 'apigateway.amazonaws.com'
    }));
  } catch (error) {
    if (!isExisting(error)) console.log(`   (permission: ${error.message})`);
  }
  return ApiId;
}

async function main() {
  console.log(`Deploying to ${process.env.AWS_ENDPOINT_URL} (${process.env.AWS_REGION})\n`);
  const secretArn = await deploySecret();
  const tableArn = await deployTable();
  await deployLogGroup();
  const roleArn = await deployRole(secretArn, tableArn);
  const functionArn = await deployFunction(roleArn);
  const apiId = await deployApi(functionArn);

  const endpoint = new URL(process.env.AWS_ENDPOINT_URL);
  console.log('\nDone. Search API through API Gateway:');
  if (/localhost|127\.0\.0\.1/.test(endpoint.hostname)) {
    console.log(`  http://${apiId}.execute-api.localhost.floci.io:${endpoint.port || 4566}/api/health`);
    console.log(`  (or) ${endpoint.origin}/execute-api/${apiId}/$default/api/health`);
  } else {
    console.log(`  https://${apiId}.execute-api.${process.env.AWS_REGION}.amazonaws.com/api/health`);
  }
  console.log('\nAudit lines: npm run aws:logs');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nDeploy failed: ${error.name}: ${error.message}`);
    if (/ECONNREFUSED|fetch failed/i.test(String(error.message) + String(error.cause))) {
      console.error('Is Floci running on port 4566?');
    }
    process.exit(1);
  });
}

module.exports = { buildZip };
