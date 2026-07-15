import { all, fork } from 'redux-saga/effects';
import authSaga from './auth.saga';
import citizenSaga from './citizen.saga';
import adminSaga from './admin.saga';

export default function* rootSaga() {
    yield all([
        fork(authSaga),
        fork(citizenSaga),
        fork(adminSaga),
    ]);
}
