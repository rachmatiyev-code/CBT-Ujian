/**
 * Google Authentication & Identity Service
 * Uses Google Identity Services (GIS) directly without Firebase dependencies.
 */

import firebaseConfig from "../../firebase-applet-config.json";

export interface GoogleUser {
  displayName?: string;
  email?: string;
  photoURL?: string;
  uid?: string;
}

export type User = GoogleUser;

export const PRIMARY_USER_EMAIL = "rachmatiyev@gmail.com";

export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
];

const AUTH_STORAGE_KEY = "slideexam_gdrive_auth_session";
const CLIENT_ID_STORAGE_KEY = "slideexam_google_client_id";

type AuthExpiredListener = () => void;
const authExpiredListeners = new Set<AuthExpiredListener>();

type AuthStateListener = (user: GoogleUser | null, token: string | null) => void;
const authStateListeners = new Set<AuthStateListener>();

export const onGoogleAuthExpired = (cb: AuthExpiredListener) => {
  authExpiredListeners.add(cb);
  return () => {
    authExpiredListeners.delete(cb);
  };
};

export const clearAuthSession = () => {
  cachedAccessToken = null;
  cachedUser = null;
  try {
    if (typeof window !== "undefined") {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch (e) {
    console.warn("Failed clearing auth session", e);
  }
  authStateListeners.forEach((cb) => {
    try {
      cb(null, null);
    } catch {}
  });
};

export const notifyAuthExpired = () => {
  clearAuthSession();
  authExpiredListeners.forEach((cb) => {
    try {
      cb();
    } catch {}
  });
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent("google-drive-auth-expired"));
    } catch {}
  }
};

export const isAuthExpiredError = (error: any): boolean => {
  if (!error) return false;
  const msg = (
    typeof error === "string" ? error : error?.message || error?.error?.message || ""
  ).toLowerCase();
  const status = error?.status || error?.code || error?.statusCode || 0;
  return (
    status === 401 ||
    status === "UNAUTHENTICATED" ||
    msg.includes("invalid authentication credentials") ||
    msg.includes("unauthenticated") ||
    msg.includes("oauth 2 access token") ||
    msg.includes("login cookie") ||
    msg.includes("token expired") ||
    msg.includes("token_expired") ||
    msg.includes("invalid_token") ||
    msg.includes("auth_expired") ||
    msg.includes("unauthorized")
  );
};

export const formatGoogleAuthErrorMessage = (error: any): string => {
  if (isAuthExpiredError(error)) {
    return "Sesi login Google telah kedaluwarsa. Silakan hubungkan ulang akun Google Anda.";
  }
  const msg = error?.message || String(error);
  if (msg.includes("popup-closed-by-user") || msg.includes("access_denied")) {
    return "Jendela otorisasi Google ditutup sebelum selesai atau izin ditolak.";
  }
  if (msg.includes("popup-blocked")) {
    return "Jendela pop-up diblokir oleh browser. Harap izinkan pop-up untuk situs ini.";
  }
  return msg;
};

let cachedAccessToken: string | null = (() => {
  try {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(AUTH_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.token && parsed.expiresAt && Date.now() < parsed.expiresAt) {
          return parsed.token;
        } else if (parsed.expiresAt && Date.now() >= parsed.expiresAt) {
          localStorage.removeItem(AUTH_STORAGE_KEY);
        }
      }
    }
  } catch (e) {
    console.warn("Could not read auth storage", e);
  }
  return null;
})();

let cachedUser: GoogleUser | null = (() => {
  try {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(AUTH_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Cleanse any old session tied to belajar.id
        if (parsed?.user?.email && parsed.user.email.toLowerCase().includes("belajar.id")) {
          console.warn("Ditemukan sesi lama dengan akun @belajar.id, menghapus sesi agar berganti ke akun utama:", PRIMARY_USER_EMAIL);
          localStorage.removeItem(AUTH_STORAGE_KEY);
          return null;
        }
        if (parsed.token && parsed.expiresAt && Date.now() < parsed.expiresAt) {
          const user = parsed.user || { displayName: "Rachmat (Google)", email: PRIMARY_USER_EMAIL };
          if (!user.email) user.email = PRIMARY_USER_EMAIL;
          return user;
        }
      }
    }
  } catch (e) {
    console.warn("Could not read user storage", e);
  }
  return null;
})();

export const saveAuthSession = (user: GoogleUser, token: string) => {
  try {
    if (user.email && user.email.toLowerCase().includes("belajar.id")) {
      throw new Error(
        `Akun ${user.email} (@belajar.id) dibatasi oleh domain sekolah. Harap gunakan akun ${PRIMARY_USER_EMAIL}.`
      );
    }
    if (!user.email) {
      user.email = PRIMARY_USER_EMAIL;
    }
    cachedAccessToken = token;
    cachedUser = user;
    if (typeof window !== "undefined") {
      // 50 minutes validity before refresh
      const expiresAt = Date.now() + 50 * 60 * 1000;
      localStorage.setItem(
        AUTH_STORAGE_KEY,
        JSON.stringify({ user, token, expiresAt })
      );
    }
    authStateListeners.forEach((cb) => {
      try {
        cb(user, token);
      } catch {}
    });
  } catch (e) {
    console.warn("Failed saving auth session", e);
    throw e;
  }
};

/**
 * Initialize auth listener
 */
export const initAuth = (
  onAuthSuccess?: (user: GoogleUser, token: string) => void,
  onAuthFailure?: () => void
) => {
  if (cachedUser && cachedAccessToken) {
    if (onAuthSuccess) onAuthSuccess(cachedUser, cachedAccessToken);
  } else {
    if (onAuthFailure) onAuthFailure();
  }

  const listener: AuthStateListener = (user, token) => {
    if (user && token) {
      if (onAuthSuccess) onAuthSuccess(user, token);
    } else {
      if (onAuthFailure) onAuthFailure();
    }
  };

  authStateListeners.add(listener);
  return () => {
    authStateListeners.delete(listener);
  };
};

/**
 * Helper to dynamically load GIS script if not present
 */
const loadGISScript = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (typeof (window as any).google?.accounts?.oauth2 !== 'undefined') {
      resolve();
      return;
    }
    const existing = document.getElementById('google-gis-script');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', (err) => reject(err));
      return;
    }
    const script = document.createElement('script');
    script.id = 'google-gis-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = (e) => reject(new Error('Gagal memuat Google Identity Services script'));
    document.head.appendChild(script);
  });
};

/**
 * Get configured OAuth Client ID
 * Prioritizes custom user override, then VITE_GOOGLE_CLIENT_ID, then firebase-applet-config.json
 */
export const getOAuthClientId = (): string => {
  try {
    if (typeof window !== "undefined") {
      const custom = localStorage.getItem(CLIENT_ID_STORAGE_KEY);
      if (custom && custom.trim().length > 0) return custom.trim();
    }
  } catch {}

  const envClientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID;
  if (envClientId && typeof envClientId === "string" && envClientId.trim().length > 0) {
    return envClientId.trim();
  }

  if (
    firebaseConfig?.oAuthClientId &&
    typeof firebaseConfig.oAuthClientId === "string" &&
    firebaseConfig.oAuthClientId.trim().length > 0
  ) {
    return firebaseConfig.oAuthClientId.trim();
  }

  return "";
};

export const setOAuthClientId = (clientId: string): void => {
  try {
    if (typeof window !== "undefined") {
      if (clientId && clientId.trim().length > 0) {
        localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId.trim());
      } else {
        localStorage.removeItem(CLIENT_ID_STORAGE_KEY);
      }
    }
  } catch {}
};

/**
 * Reset OAuth Client ID to default from firebase-applet-config.json
 */
export const resetOAuthClientIdToDefault = (): string => {
  try {
    if (typeof window !== "undefined") {
      localStorage.removeItem(CLIENT_ID_STORAGE_KEY);
    }
  } catch {}
  return getOAuthClientId();
};

/**
 * Request Google Token via GIS (Google Identity Services)
 */
export const requestGoogleTokenViaGIS = async (
  clientId?: string,
  silent = false
): Promise<{ user: GoogleUser; accessToken: string }> => {
  const effectiveClientId = clientId || getOAuthClientId();
  if (!effectiveClientId) {
    throw new Error(
      "Client ID Google belum disetel. Hubungkan akun Anda atau gunakan integrasi Google Apps Script & Google Sheets."
    );
  }

  await loadGISScript();

  return new Promise((resolve, reject) => {
    try {
      const google = (window as any).google;
      if (!google?.accounts?.oauth2) {
        reject(new Error("Pustaka Google Identity Services belum siap. Silakan coba beberapa saat lagi."));
        return;
      }

      const client = google.accounts.oauth2.initTokenClient({
        client_id: effectiveClientId,
        scope: DRIVE_SCOPES.join(' ') + ' email profile openid',
        hint: PRIMARY_USER_EMAIL,
        callback: async (tokenResponse: any) => {
          if (tokenResponse && tokenResponse.access_token) {
            let email = '';
            let name = 'Rachmat (Google)';
            let picture = '';

            try {
              const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
              });
              if (userInfoRes.ok) {
                const info = await userInfoRes.json();
                email = info.email || '';
                name = info.name || info.given_name || 'Rachmat (Google)';
                picture = info.picture || '';
              }
            } catch (err) {
              console.warn('Gagal mengambil info profil Google:', err);
            }

            if (email && email.toLowerCase().includes('belajar.id')) {
              reject(
                new Error(
                  `Akun Google yang Anda pilih (${email}) adalah akun @belajar.id yang dibatasi oleh kebijakan domain kementerian sekolah. Harap pilih akun pribadi Anda (${PRIMARY_USER_EMAIL}) agar naskah soal dapat diakses publik tanpa error 403.`
                )
              );
              return;
            }

            if (!email) {
              email = PRIMARY_USER_EMAIL;
            }

            const customUser: GoogleUser = {
              displayName: name,
              email: email,
              photoURL: picture,
              uid: email || "google-user-" + Date.now(),
            };
            try {
              saveAuthSession(customUser, tokenResponse.access_token);
              resolve({ user: customUser, accessToken: tokenResponse.access_token });
            } catch (saveErr: any) {
              reject(saveErr);
            }
          } else {
            const errorDesc =
              tokenResponse?.error_description ||
              tokenResponse?.error ||
              "Tidak menerima token akses dari Google. Pastikan izin akses Drive disetujui.";
            reject(new Error(errorDesc));
          }
        },
        error_callback: (err: any) => {
          const errMsg =
            err?.message ||
            err?.type ||
            (typeof err === "string" ? err : "Otentikasi Google ditolak atau jendela pop-up ditutup.");
          reject(new Error(errMsg));
        },
      });
      client.requestAccessToken({ prompt: silent ? '' : 'select_account', hint: PRIMARY_USER_EMAIL });
    } catch (err) {
      reject(err);
    }
  });
};

export const getPrimaryUserEmail = (): string => PRIMARY_USER_EMAIL;

/**
 * Sign in with Google Popup and obtain access token
 */
export const googleSignIn = async (): Promise<{ user: GoogleUser; accessToken: string } | null> => {
  return await requestGoogleTokenViaGIS(undefined, false);
};

/**
 * Sign out and clear cached token
 */
export const googleSignOut = async (): Promise<void> => {
  clearAuthSession();
};

export const getCachedAccessToken = (): string | null => {
  try {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(AUTH_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.token && parsed.expiresAt && Date.now() < parsed.expiresAt) {
          cachedAccessToken = parsed.token;
          return parsed.token;
        } else if (parsed.expiresAt && Date.now() >= parsed.expiresAt) {
          clearAuthSession();
          return null;
        }
      }
    }
  } catch {}
  return cachedAccessToken;
};

export const getCachedUser = (): GoogleUser | null => {
  return cachedUser;
};

export const getValidDriveToken = async (interactive = false): Promise<string | null> => {
  const current = getCachedAccessToken();
  if (current) return current;
  const clientId = getOAuthClientId();
  if (clientId) {
    try {
      const res = await requestGoogleTokenViaGIS(clientId, !interactive);
      return res.accessToken;
    } catch {
      return null;
    }
  }
  return null;
};
