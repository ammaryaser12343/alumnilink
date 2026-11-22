// Prints the Search API's AUDIT lines from CloudWatch Logs.
// Usage (from search-api/):  npm run aws:logs            last 60 minutes
//                            npm run aws:logs -- 1440    last 24 hours
require('dotenv').config();

process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_ENDPOINT_URL = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'test';

const { CloudWatchLogsClient, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');

async function main() {
  const minutes = Number(process.argv[2]) || 60;
  const client = new CloudWatchLogsClient({});
  let nextToken;
  let count = 0;
  do {
    const page = await client.send(new FilterLogEventsCommand({
      logGroupName: '/aws/lambda/alumnilink-search',
      startTime: Date.now() - minutes * 60 * 1000,
      filterPattern: 'AUDIT',
      nextToken
    }));
    for (const event of page.events || []) {
      const line = event.message.slice(event.message.indexOf('AUDIT'));
      console.log(line.trim());
      count += 1;
    }
    nextToken = page.nextToken;
  } while (nextToken);
  console.log(`\n${count} audit events in the last ${minutes} minutes.`);
}

main().catch((error) => {
  console.error(`${error.name}: ${error.message}`);
  process.exit(1);
});
