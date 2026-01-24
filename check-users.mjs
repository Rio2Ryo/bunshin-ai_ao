import { db } from './server/db.js';
import { users } from './drizzle/schema.js';

async function main() {
  const allUsers = await db.select().from(users).limit(5);
  console.log(JSON.stringify(allUsers, null, 2));
  process.exit(0);
}

main().catch(console.error);
