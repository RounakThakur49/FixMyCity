import { call, put, takeLatest } from 'redux-saga/effects';
import axios from 'axios';
import {
    FETCH_USER_HOME_REQUEST,
    fetchUserHomeSuccess,
    fetchUserHomeError,
    REGISTER_COMPLAINT_REQUEST,
    registerComplaintSuccess,
    registerComplaintError,
    type FetchUserHomeRequestAction,
    type RegisterComplaintRequestAction
} from '../actions/citizen.slice';
import { getUserHome, postRegisterComplaint } from '../apis/functions';

export function* getUserHomeSaga(action: FetchUserHomeRequestAction): any {
    try {
        const data: Awaited<ReturnType<typeof getUserHome>> = yield call(
            getUserHome,
            action.payload
        );
        console.log('Fetch user home success', data);
        yield put(fetchUserHomeSuccess(data));
    } catch (err) {
        const message =
            axios.isAxiosError(err) && err.response?.data
                ? (err.response.data as { message?: string }).message ?? err.message
                : err instanceof Error
                    ? err.message
                    : 'Fetching user home failed.';
        yield put(fetchUserHomeError(message));
    }
}

export function* registerComplaintSaga(action: RegisterComplaintRequestAction): any {
    try {
        const data: Awaited<ReturnType<typeof postRegisterComplaint>> = yield call(
            postRegisterComplaint,
            action.payload
        );
        console.log('Register complaint success', data);
        yield put(registerComplaintSuccess(data));
    } catch (err) {
        let message = 'Registering complaint failed.';
        if (axios.isAxiosError(err) && err.code === 'ECONNABORTED') {
            message = 'The server is taking longer than usual. Please try again in a moment.';
        } else if (axios.isAxiosError(err) && err.response?.data) {
            const data = err.response.data as { message?: string; suggestion?: string };
            message = data.message ?? err.message;
            if (data.suggestion) message += ' ' + data.suggestion;
        } else if (err instanceof Error) {
            message = err.message;
        }
        yield put(registerComplaintError(message));
    }
}

export function* citizenSaga(): any {
    yield takeLatest(FETCH_USER_HOME_REQUEST, getUserHomeSaga);
    yield takeLatest(REGISTER_COMPLAINT_REQUEST, registerComplaintSaga);
}

export default citizenSaga;
