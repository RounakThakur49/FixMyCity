export const FETCH_USER_HOME_REQUEST = 'citizen/fetchUserHomeRequest';
export const FETCH_USER_HOME_SUCCESS = 'citizen/fetchUserHomeSuccess';
export const FETCH_USER_HOME_ERROR = 'citizen/fetchUserHomeError';

export interface FetchUserHomePayload {
    userId: string;
    role: string;
}

export interface FetchUserHomeRequestAction {
    type: typeof FETCH_USER_HOME_REQUEST;
    payload: FetchUserHomePayload;
}

export interface FetchUserHomeSuccessAction {
    type: typeof FETCH_USER_HOME_SUCCESS;
    payload: any; // backend response data
}

export interface FetchUserHomeErrorAction {
    type: typeof FETCH_USER_HOME_ERROR;
    payload: string;
}

// Removed first definition of CitizenAction to avoid duplicate identifier conflict with the one below.

export const fetchUserHomeRequest = (payload: FetchUserHomePayload): FetchUserHomeRequestAction => ({
    type: FETCH_USER_HOME_REQUEST,
    payload,
});

export const fetchUserHomeSuccess = (payload: any): FetchUserHomeSuccessAction => ({
    type: FETCH_USER_HOME_SUCCESS,
    payload,
});

export const fetchUserHomeError = (error: string): FetchUserHomeErrorAction => ({
    type: FETCH_USER_HOME_ERROR,
    payload: error,
});

// ----- Register Complaint actions -----
export const REGISTER_COMPLAINT_REQUEST = 'citizen/registerComplaintRequest';
export const REGISTER_COMPLAINT_SUCCESS = 'citizen/registerComplaintSuccess';
export const REGISTER_COMPLAINT_ERROR   = 'citizen/registerComplaintError';
export const REGISTER_COMPLAINT_RESET   = 'citizen/registerComplaintReset';

export interface RegisterComplaintPayload {
    formData: FormData;
    userId: string;
    role: string;
}

export interface RegisterComplaintRequestAction {
    type: typeof REGISTER_COMPLAINT_REQUEST;
    payload: RegisterComplaintPayload;
}

export interface RegisterComplaintSuccessAction {
    type: typeof REGISTER_COMPLAINT_SUCCESS;
    payload: any;
}

export interface RegisterComplaintErrorAction {
    type: typeof REGISTER_COMPLAINT_ERROR;
    payload: string;
}

export interface RegisterComplaintResetAction {
    type: typeof REGISTER_COMPLAINT_RESET;
}

export type CitizenAction =
    | FetchUserHomeRequestAction
    | FetchUserHomeSuccessAction
    | FetchUserHomeErrorAction
    | RegisterComplaintRequestAction
    | RegisterComplaintSuccessAction
    | RegisterComplaintErrorAction
    | RegisterComplaintResetAction;

export const registerComplaintRequest = (payload: RegisterComplaintPayload): RegisterComplaintRequestAction => ({
    type: REGISTER_COMPLAINT_REQUEST,
    payload,
});

export const registerComplaintSuccess = (payload: any): RegisterComplaintSuccessAction => ({
    type: REGISTER_COMPLAINT_SUCCESS,
    payload,
});

export const registerComplaintError = (error: string): RegisterComplaintErrorAction => ({
    type: REGISTER_COMPLAINT_ERROR,
    payload: error,
});

export const registerComplaintReset = (): RegisterComplaintResetAction => ({
    type: REGISTER_COMPLAINT_RESET,
});
