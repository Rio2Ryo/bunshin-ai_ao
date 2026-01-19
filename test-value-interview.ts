import { conductValueScenarioInterview } from "./server/services/valueScenarioService";

async function test() {
  try {
    console.log("Testing value scenario interview...");
    const result = await conductValueScenarioInterview(
      1, // userId
      1, // twinId
      [], // conversationHistory
      "ボランティアに参加します。困っている人を助けることは大切だと思うからです。" // userMessage
    );
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Error:", error);
  }
}

test();
