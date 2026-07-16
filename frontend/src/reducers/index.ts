import { combineReducers } from 'redux';
import authReducer from './auth.reducer';
import citizenReducer from './citizen.reducer';
import adminReducer from './admin.reducer';

const rootReducer = combineReducers({
    auth: authReducer,
    citizen: citizenReducer,
    admin: adminReducer,
});

export default rootReducer;
export type RootState = ReturnType<typeof rootReducer>;
