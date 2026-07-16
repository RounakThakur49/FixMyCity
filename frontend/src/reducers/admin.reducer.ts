import {
    FETCH_ADMIN_HOME_REQUEST,
    FETCH_ADMIN_HOME_SUCCESS,
    FETCH_ADMIN_HOME_ERROR,
    UPDATE_STATUS_REQUEST,
    UPDATE_STATUS_SUCCESS,
    UPDATE_STATUS_ERROR,
    UPDATE_STATUS_RESET,
    type AdminAction
} from '../actions/admin.slice';

export interface AdminState {
    loading: boolean;
    error: string | null;
    complaints: any[];
    statusMap: any;
    updateStatusLoading: boolean;
    updateStatusError: string | null;
    updateStatusSuccess: boolean;
}

const initialState: AdminState = {
    loading: false,
    error: null,
    complaints: [],
    statusMap: {},
    updateStatusLoading: false,
    updateStatusError: null,
    updateStatusSuccess: false,
};

export function adminReducer(
    state: AdminState = initialState,
    action: AdminAction
): AdminState {
    switch (action.type) {
        case FETCH_ADMIN_HOME_REQUEST:
            return {
                ...state,
                loading: state.complaints.length === 0,
                error: null
            };
        case FETCH_ADMIN_HOME_SUCCESS:
            return {
                ...state,
                loading: false,
                complaints: action.payload.complaints || [],
                statusMap: action.payload.statusMap || {},
                error: null
            };
        case FETCH_ADMIN_HOME_ERROR:
            return {
                ...state,
                loading: false,
                error: action.payload
            };
        case UPDATE_STATUS_REQUEST:
            return {
                ...state,
                updateStatusLoading: true,
                updateStatusError: null,
                updateStatusSuccess: false,
            };
        case UPDATE_STATUS_SUCCESS:
            return {
                ...state,
                updateStatusLoading: false,
                updateStatusSuccess: true,
                updateStatusError: null,
            };
        case UPDATE_STATUS_ERROR:
            return {
                ...state,
                updateStatusLoading: false,
                updateStatusError: action.payload,
                updateStatusSuccess: false,
            };
        case UPDATE_STATUS_RESET:
            return {
                ...state,
                updateStatusLoading: false,
                updateStatusError: null,
                updateStatusSuccess: false,
            };
        default:
            return state;
    }
}

export default adminReducer;

