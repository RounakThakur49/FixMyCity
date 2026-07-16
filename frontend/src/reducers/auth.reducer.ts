// =============================================================================
// auth.reducer.ts — Auth state with JWT token + OTP flow support
// =============================================================================

import {
    SIGNUP_REQUEST, SIGNUP_SUCCESS, SIGNUP_ERROR,
    LOGIN_REQUEST,  LOGIN_SUCCESS,  LOGIN_ERROR,
    OTP_REQUIRED,   OTP_VERIFY_REQUEST, OTP_VERIFY_SUCCESS, OTP_VERIFY_ERROR, OTP_CANCEL,
    LOGOUT_REQUEST, LOGOUT_SUCCESS, LOGOUT_ERROR,
    type AuthAction,
} from '../actions/auth.slice';
import { TOKEN_KEY } from '../apis/axios.baseClient';

// ── State ─────────────────────────────────────────────────────────────────────
export interface AuthState {
    loading:      boolean;
    error:        string | null;
    user:         unknown | null;
    token:        string | null;    // JWT stored in sessionStorage + state
    // OTP flow (superadmin only)
    otpPending:   boolean;          // true while OTP prompt is shown
    pendingToken: string | null;    // short-lived token from backend OTP step
    otpLoading:   boolean;
    otpError:     string | null;
}

// ── Rehydrate from sessionStorage ─────────────────────────────────────────────
function loadStoredState(): Pick<AuthState, 'user' | 'token'> {
    try {
        const storedUser  = sessionStorage.getItem('user');
        const storedToken = sessionStorage.getItem(TOKEN_KEY);
        return {
            user:  storedUser  ? JSON.parse(storedUser) : null,
            token: storedToken || null,
        };
    } catch {
        return { user: null, token: null };
    }
}

const { user: storedUser, token: storedToken } = loadStoredState();

const initialState: AuthState = {
    loading:      false,
    error:        null,
    user:         storedUser,
    token:        storedToken,
    otpPending:   false,
    pendingToken: null,
    otpLoading:   false,
    otpError:     null,
};

// ── Helper — persist user + token after a successful login/OTP ────────────────
function persistSession(data: any): { user: any; token: string | null } {
    const token = data?.token || null;
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem('user', JSON.stringify(data));
    return { user: data, token };
}

// ── Reducer ───────────────────────────────────────────────────────────────────
export function authReducer(
    state: AuthState = initialState,
    action: AuthAction,
): AuthState {
    switch (action.type) {
        // ── Loading states ─────────────────────────────────────────────────
        case SIGNUP_REQUEST:
        case LOGIN_REQUEST:
        case LOGOUT_REQUEST:
            return { ...state, loading: true, error: null };

        // ── Signup / Login success ─────────────────────────────────────────
        case SIGNUP_SUCCESS:
        case LOGIN_SUCCESS: {
            const data = action.payload as any;
            const { user, token } = persistSession(data);
            return { ...state, loading: false, error: null, user, token, otpPending: false, pendingToken: null };
        }

        // ── Login error ────────────────────────────────────────────────────
        case SIGNUP_ERROR:
        case LOGIN_ERROR:
            return { ...state, loading: false, error: action.payload };

        // ── OTP flow ───────────────────────────────────────────────────────
        case OTP_REQUIRED:
            // Backend returned requiresOtp:true — store pendingToken, show OTP UI
            return {
                ...state,
                loading:      false,
                error:        null,
                otpPending:   true,
                pendingToken: action.payload.pendingToken,
            };

        case OTP_VERIFY_REQUEST:
            return { ...state, otpLoading: true, otpError: null };

        case OTP_VERIFY_SUCCESS: {
            const data = action.payload as any;
            const { user, token } = persistSession(data);
            return {
                ...state,
                otpLoading:   false,
                otpError:     null,
                otpPending:   false,
                pendingToken: null,
                user,
                token,
            };
        }

        case OTP_VERIFY_ERROR:
            return { ...state, otpLoading: false, otpError: action.payload };

        case OTP_CANCEL:
            return { ...state, otpPending: false, pendingToken: null, otpError: null };

        // ── Logout ─────────────────────────────────────────────────────────
        case LOGOUT_SUCCESS:
            sessionStorage.removeItem(TOKEN_KEY);
            sessionStorage.removeItem('user');
            return {
                ...state,
                loading: false, error: null,
                user: null, token: null,
                otpPending: false, pendingToken: null, otpLoading: false, otpError: null,
            };

        case LOGOUT_ERROR:
            // Even on logout error, clear local session
            sessionStorage.removeItem(TOKEN_KEY);
            sessionStorage.removeItem('user');
            return { ...state, loading: false, error: action.payload, user: null, token: null };

        default:
            return state;
    }
}

export default authReducer;
