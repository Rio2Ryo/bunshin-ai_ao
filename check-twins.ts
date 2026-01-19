import { getDb } from "./server/db";
import { digitalTwins } from "./drizzle/schema";

async function check() {
  const db = await getDb();
  if (!db) {
    console.log("DB not available");
    return;
  }
  const twins = await db.select().from(digitalTwins);
  console.log("Twins:", twins.map(t => ({
    id: t.id,
    name: t.name,
    hasPersonality: !!t.personality,
    personalityLength: t.personality?.length || 0
  })));
}

check();
