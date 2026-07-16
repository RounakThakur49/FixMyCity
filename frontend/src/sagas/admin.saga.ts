import { call, put, takeLatest } from 'redux-saga/effects';
import axios from 'axios';
import {
    FETCH_ADMIN_HOME_REQUEST,
    fetchAdminHomeSuccess,
    fetchAdminHomeError,
    type FetchAdminHomeRequestAction,
    UPDATE_STATUS_REQUEST,
    updateStatusSuccess,
    updateStatusError,
    type UpdateStatusRequestAction
} from '../actions/admin.slice';
import { getAdminHome, postUpdateStatus } from '../apis/functions';

export function* getAdminHomeSaga(action: FetchAdminHomeRequestAction): any {
    try {
        const data: Awaited<ReturnType<typeof getAdminHome>> = yield call(
            getAdminHome,
            action.payload
        );
        console.log('Fetch admin home success', data);
        yield put(fetchAdminHomeSuccess(data));
    } catch (err) {
        const message =
            axios.isAxiosError(err) && err.response?.data
                ? (err.response.data as { message?: string }).message ?? err.message
                : err instanceof Error
                    ? err.message
                    : 'Fetching admin home failed.';
        yield put(fetchAdminHomeError(message));
    }
}

export function* updateStatusSaga(action: UpdateStatusRequestAction): any {
    try {
        const data: Awaited<ReturnType<typeof postUpdateStatus>> = yield call(
            postUpdateStatus,
            action.payload
        );
        console.log('Update status success', data);
        yield put(updateStatusSuccess(data));
    } catch (err) {
        const message =
            axios.isAxiosError(err) && err.response?.data
                ? (err.response.data as { message?: string }).message ?? err.message
                : err instanceof Error
                    ? err.message
                    : 'Updating status failed.';
        yield put(updateStatusError(message));
    }
}

export function* adminSaga(): any {
    yield takeLatest(FETCH_ADMIN_HOME_REQUEST, getAdminHomeSaga);
    yield takeLatest(UPDATE_STATUS_REQUEST, updateStatusSaga);
}

export default adminSaga;
