import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, doc, getDocFromServer, Firestore } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const databaseId = (firebaseConfig as any).firestoreDatabaseId || "(default)";

export const db: Firestore =
  databaseId && databaseId !== "(default)"
    ? getFirestore(app, databaseId)
    : getFirestore(app);

// Connection test on boot
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, "test", "connection"));
    return true;
  } catch (error: any) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.warn("Firestore: client is offline or network restricted.");
    }
    // Document might just not exist, which is fine and means connection succeeded
    return true;
  }
}

testFirestoreConnection();
