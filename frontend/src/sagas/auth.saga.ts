// =============================================================================
// auth.saga.ts — Redux-Saga workers for auth flows
// =============================================================================
// Handles signup, login (with superadmin OTP branch), OTP verify, and logout.
// All HTTP calls use apiBaseFMCClient (Bearer JWT auto-attached via interceptor).
// =============================================================================

import { call, put, takeLatest } from 'redux-saga/effects';
import axios from 'axios';
import {
    SIGNUP_REQUEST,
    signupSuccess,
    signupError,
    LOGIN_REQUEST,
    loginSuccess,
    loginError,
    otpRequired,
    OTP_VERIFY_REQUEST,
    otpVerifySuccess,
    otpVerifyError,
    LOGOUT_REQUEST,
    logoutSuccess,
    logoutError,
    type SignupRequestAction,
    type LoginRequestAction,
    type OtpVerifyRequestAction,
} from '../actions/auth.slice';
import { postLogin, postVerifyOtp, postLogout, postRegister } from '../apis/functions';
import type { RegisterApiPayload } from '../actions/transformer';

// ── Signup ────────────────────────────────────────────────────────────────────
export function* signUpSaga(action: SignupRequestAction): any {
    try {
        const data: any = yield call(postRegister, action.payload as any);
        console.log('[saga] Signup success', data);
        // Store JWT if returned (register auto-logs citizen in)
        if (data?.token) {
            sessionStorage.setItem('fmc_token', data.token);
        }
        if (data) {
            sessionStorage.setItem('user', JSON.stringify(data));
        }
        yield put(signupSuccess(data));
    } catch (err) {
        const message = extractErrorMessage(err, 'Signup failed.');
        yield put(signupError(message));
    }
}

// ── Login ─────────────────────────────────────────────────────────────────────
export function* logInSaga(action: LoginRequestAction): any {
    try {
        const data: any = yield call(postLogin, action.payload);
        console.log('[saga] Login response', data);

        if (data?.requiresOtp) {
            // Superadmin path: backend says "OTP required", pendingToken provided
            yield put(otpRequired({ pendingToken: data.pendingToken }));
        } else {
            // Regular citizen/admin path: store JWT + dispatch loginSuccess
            if (data?.token) {
                sessionStorage.setItem('fmc_token', data.token);
            }
            sessionStorage.setItem('user', JSON.stringify(data));
            yield put(loginSuccess(data));
        }
    } catch (err) {
        const message = extractErrorMessage(err, 'Login failed.');
        yield put(loginError(message));
    }
}

// ── OTP Verify ────────────────────────────────────────────────────────────────
export function* otpVerifySaga(action: OtpVerifyRequestAction): any {
    try {
        const data: any = yield call(postVerifyOtp, action.payload);
        console.log('[saga] OTP verify success', data);
        if (data?.token) {
            sessionStorage.setItem('fmc_token', data.token);
        }
        sessionStorage.setItem('user', JSON.stringify(data));
        yield put(otpVerifySuccess(data));
    } catch (err) {
        const message = extractErrorMessage(err, 'OTP verification failed.');
        yield put(otpVerifyError(message));
    }
}

// ── Logout ────────────────────────────────────────────────────────────────────
export function* logOutSaga(): any {
    try {
        yield call(postLogout);
        yield put(logoutSuccess());
    } catch (err) {
        // Even if the server-side call fails, clear local state
        sessionStorage.removeItem('fmc_token');
        sessionStorage.removeItem('user');
        yield put(logoutSuccess());
    }
}

// ── Watcher ───────────────────────────────────────────────────────────────────
export function* authSaga(): any {
    yield takeLatest(SIGNUP_REQUEST,      signUpSaga);
    yield takeLatest(LOGIN_REQUEST,       logInSaga);
    yield takeLatest(OTP_VERIFY_REQUEST,  otpVerifySaga);
    yield takeLatest(LOGOUT_REQUEST,      logOutSaga);
}

// ── Helper ────────────────────────────────────────────────────────────────────
function extractErrorMessage(err: unknown, fallback: string): string {
    if (axios.isAxiosError(err) && err.response?.data) {
        const d = err.response.data as { message?: string };
        return d.message ?? err.message;
    }
    if (err instanceof Error) return err.message;
    return fallback;
}

export default authSaga;
