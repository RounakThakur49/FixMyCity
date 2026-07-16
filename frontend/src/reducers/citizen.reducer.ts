import {
    FETCH_USER_HOME_REQUEST,
    FETCH_USER_HOME_SUCCESS,
    FETCH_USER_HOME_ERROR,
    REGISTER_COMPLAINT_REQUEST,
    REGISTER_COMPLAINT_SUCCESS,
    REGISTER_COMPLAINT_ERROR,
    REGISTER_COMPLAINT_RESET,
    type CitizenAction
} from '../actions/citizen.slice';

export interface CitizenState {
    loading: boolean;
    error: string | null;
    registeredComplaints: any[];
    statusMap: any;
    registerSuccess: boolean;
}

const initialState: CitizenState = {
    loading: false,
    error: null,
    registeredComplaints: [],
    statusMap: {},
    registerSuccess: false,
};

export function citizenReducer(
    state: CitizenState = initialState,
    action: CitizenAction
): CitizenState {
    switch (action.type) {
        case FETCH_USER_HOME_REQUEST:
            return {
                ...state,
                // Only show loading spinner on initial load (empty list).
                // Subsequent polls (auto-sync) update silently.
                loading: state.registeredComplaints.length === 0,
                error: null,
            };
        case REGISTER_COMPLAINT_REQUEST:
            return {
                ...state,
                loading: true,
                error: null,
                registerSuccess: false
            };
        case FETCH_USER_HOME_SUCCESS:
            return {
                ...state,
                loading: false,
                registeredComplaints: action.payload.registeredComplaints || [],
                statusMap: action.payload.statusMap || {},
                error: null
            };
        case REGISTER_COMPLAINT_SUCCESS:
            return {
                ...state,
                loading: false,
                registerSuccess: true,
                error: null
            };
        case FETCH_USER_HOME_ERROR:
        case REGISTER_COMPLAINT_ERROR:
            return {
                ...state,
                loading: false,
                error: action.payload,
                registerSuccess: false
            };
        case REGISTER_COMPLAINT_RESET:
            return {
                ...state,
                registerSuccess: false,
                error: null
            };
        default:
            return state;
    }
}

export default citizenReducer;
