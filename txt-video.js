import fs from "fs";
import { InferenceClient } from "@huggingface/inference";

const client = new InferenceClient("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");

async function run() {
  try {
    const video = await client.textToVideo({
      provider: "replicate",
      model: "Wan-AI/Wan2.2-TI2V-5B",
      inputs: "A man working with Asus Zenbook Laptop sfotware development",
    });

    const arrayBuffer = await video.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync("output.mp4", buffer);

    console.log("✅ Video saved as output.mp4");
  } catch (err) {
    console.error("❌ Error:", err);
  }
}

run();
