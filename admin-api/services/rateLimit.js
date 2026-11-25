// Counts attempts per key per minute (same design as search-api/services/rateLimit.js).
// On Floci or AWS the counts live in a DynamoDB table (RATE_LIMIT_TABLE), because each
// Lambda instance has its own memory and could not see the others' counts.
// Locally, without the table, a simple in-memory Map is used.
const { DynamoDBClient, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');

let client;
const memoryCounts = new Map();

function currentMinute() {
  return Math.floor(Date.now() / 60000);
}

async function countInDynamo(table, key, expiresAt) {
  client = client || new DynamoDBClient({});
  // ADD is atomic, so two requests at the same moment are both counted.
  const result = await client.send(new UpdateItemCommand({
    TableName: table,
    Key: { pk: { S: key } },
    UpdateExpression: 'ADD hits :one SET expiresAt = if_not_exists(expiresAt, :expires)',
    ExpressionAttributeValues: { ':one': { N: '1' }, ':expires': { N: String(expiresAt) } },
    ReturnValues: 'UPDATED_NEW'
  }));
  return Number(result.Attributes.hits.N);
}

function countInMemory(key) {
  const hits = (memoryCounts.get(key) || 0) + 1;
  memoryCounts.set(key, hits);
  // Drop old minutes so the Map does not grow forever.
  if (memoryCounts.size > 5000) memoryCounts.clear();
  return hits;
}

// Returns how many attempts were made with this key in the current minute, including this one.
async function countAttempt(name) {
  const minute = currentMinute();
  const key = `${name}#${minute}`;
  const table = process.env.RATE_LIMIT_TABLE;
  if (!table) {
    return countInMemory(key);
  }
  // Rows expire two minutes later through DynamoDB TTL.
  return countInDynamo(table, key, (minute + 2) * 60);
}

module.exports = { countAttempt };