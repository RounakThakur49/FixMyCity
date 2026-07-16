// =============================================================================
// auth.slice.ts — Auth Redux actions (plain Redux, no RTK)
// =============================================================================
// Handles: signup, login (with superadmin OTP flow), OTP verify, logout
// =============================================================================

import type { RegisterApiPayload } from './transformer';

// ── Action types ──────────────────────────────────────────────────────────────
export const SIGNUP_REQUEST = 'auth/signupRequest';
export const SIGNUP_SUCCESS = 'auth/signupSuccess';
export const SIGNUP_ERROR   = 'auth/signupError';

export const LOGIN_REQUEST  = 'auth/loginRequest';
export const LOGIN_SUCCESS  = 'auth/loginSuccess';
export const LOGIN_ERROR    = 'auth/loginError';

// Superadmin OTP flow: login returns requiresOtp:true → show OTP prompt → verify
export const OTP_REQUIRED   = 'auth/otpRequired';    // backend says OTP needed
export const OTP_VERIFY_REQUEST = 'auth/otpVerifyRequest';
export const OTP_VERIFY_SUCCESS = 'auth/otpVerifySuccess';
export const OTP_VERIFY_ERROR   = 'auth/otpVerifyError';
export const OTP_CANCEL     = 'auth/otpCancel';       // user cancels OTP step

export const LOGOUT_REQUEST = 'auth/logoutRequest';
export const LOGOUT_SUCCESS = 'auth/logoutSuccess';
export const LOGOUT_ERROR   = 'auth/logoutError';

// ── Payload types ─────────────────────────────────────────────────────────────
export interface LoginPayload {
    email?: string;
    identifier?: string;
    password: string;
    role: string;
}

export interface OtpVerifyPayload {
    otp: string;
    pendingToken: string;
}

// ── Action interfaces ─────────────────────────────────────────────────────────
export interface SignupRequestAction   { type: typeof SIGNUP_REQUEST; payload: RegisterApiPayload; }
export interface SignupSuccessAction   { type: typeof SIGNUP_SUCCESS; payload: unknown; }
export interface SignupErrorAction     { type: typeof SIGNUP_ERROR;   payload: string; }

export interface LoginRequestAction    { type: typeof LOGIN_REQUEST;  payload: LoginPayload; }
export interface LoginSuccessAction    { type: typeof LOGIN_SUCCESS;  payload: unknown; }
export interface LoginErrorAction      { type: typeof LOGIN_ERROR;    payload: string; }

export interface OtpRequiredAction     { type: typeof OTP_REQUIRED;   payload: { pendingToken: string }; }
export interface OtpVerifyRequestAction{ type: typeof OTP_VERIFY_REQUEST; payload: OtpVerifyPayload; }
export interface OtpVerifySuccessAction{ type: typeof OTP_VERIFY_SUCCESS; payload: unknown; }
export interface OtpVerifyErrorAction  { type: typeof OTP_VERIFY_ERROR;   payload: string; }
export interface OtpCancelAction       { type: typeof OTP_CANCEL; }

export interface LogoutRequestAction   { type: typeof LOGOUT_REQUEST; }
export interface LogoutSuccessAction   { type: typeof LOGOUT_SUCCESS; }
export interface LogoutErrorAction     { type: typeof LOGOUT_ERROR;   payload: string; }

export type AuthAction =
    | SignupRequestAction  | SignupSuccessAction  | SignupErrorAction
    | LoginRequestAction   | LoginSuccessAction   | LoginErrorAction
    | OtpRequiredAction    | OtpVerifyRequestAction | OtpVerifySuccessAction | OtpVerifyErrorAction | OtpCancelAction
    | LogoutRequestAction  | LogoutSuccessAction  | LogoutErrorAction;

// ── Action creators ───────────────────────────────────────────────────────────
export const signupRequest = (payload: RegisterApiPayload): SignupRequestAction =>
    ({ type: SIGNUP_REQUEST, payload });
export const signupSuccess = (payload: unknown): SignupSuccessAction =>
    ({ type: SIGNUP_SUCCESS, payload });
export const signupError = (error: string): SignupErrorAction =>
    ({ type: SIGNUP_ERROR, payload: error });

export const loginRequest = (payload: LoginPayload): LoginRequestAction =>
    ({ type: LOGIN_REQUEST, payload });
export const loginSuccess = (payload: unknown): LoginSuccessAction =>
    ({ type: LOGIN_SUCCESS, payload });
export const loginError = (error: string): LoginErrorAction =>
    ({ type: LOGIN_ERROR, payload: error });

export const otpRequired = (payload: { pendingToken: string }): OtpRequiredAction =>
    ({ type: OTP_REQUIRED, payload });
export const otpVerifyRequest = (payload: OtpVerifyPayload): OtpVerifyRequestAction =>
    ({ type: OTP_VERIFY_REQUEST, payload });
export const otpVerifySuccess = (payload: unknown): OtpVerifySuccessAction =>
    ({ type: OTP_VERIFY_SUCCESS, payload });
export const otpVerifyError = (error: string): OtpVerifyErrorAction =>
    ({ type: OTP_VERIFY_ERROR, payload: error });
export const otpCancel = (): OtpCancelAction =>
    ({ type: OTP_CANCEL });

export const logoutRequest = (): LogoutRequestAction => ({ type: LOGOUT_REQUEST });
export const logoutSuccess = (): LogoutSuccessAction => ({ type: LOGOUT_SUCCESS });
export const logoutError = (error: string): LogoutErrorAction =>
    ({ type: LOGOUT_ERROR, payload: error });
