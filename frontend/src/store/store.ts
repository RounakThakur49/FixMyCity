import { legacy_createStore as createStore, applyMiddleware } from "redux";
import createSagaMiddleware from "redux-saga";
import { useDispatch } from "react-redux";
import rootReducer from "../reducers";
import rootSaga from "../sagas";

const sagaMiddleware = createSagaMiddleware();

export const store = createStore(
    rootReducer,
    undefined,
    applyMiddleware(sagaMiddleware)
);

sagaMiddleware.run(rootSaga);

export type AppDispatch = typeof store.dispatch;
export const useAppDispatch: () => AppDispatch = useDispatch;
