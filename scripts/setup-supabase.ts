import "../apps/api/src/load-env";
import { supabaseServiceClient } from "../apps/api/src/supabase";

const client = supabaseServiceClient();
const name = process.env.SUPABASE_REPORT_BUCKET || "moc-reports";
const { data: bucket, error } = await client.storage.getBucket(name);
if (bucket?.public) throw new Error("The report bucket must be private. Choose a private SUPABASE_REPORT_BUCKET.");
if (!bucket) {
  if (error && !["404", "400"].includes(String(error.statusCode))) throw new Error("Could not inspect the report bucket. Check Supabase URL and secret key.");
  const { error: creationError } = await client.storage.createBucket(name, { public: false, fileSizeLimit: 64 * 1024, allowedMimeTypes: ["text/csv"] });
  if (creationError) throw new Error("Could not create the private report bucket. Check Supabase storage permissions.");
}
console.log("PASS private Supabase report bucket is ready; no browser storage policies are required.");
