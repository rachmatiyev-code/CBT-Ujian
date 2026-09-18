/**
 * Firebase Client Adapter
 * Firebase has been replaced in favor of CBT Express Server and Google Apps Script.
 * This stub avoids build breaks while ensuring zero runtime Firebase traffic.
 */

export const app = null;
export const databaseId = "(default)";
export const db = null as any;

export async function testFirestoreConnection(): Promise<boolean> {
  return true;
}
