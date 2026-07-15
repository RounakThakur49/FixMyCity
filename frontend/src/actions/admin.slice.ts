export const FETCH_ADMIN_HOME_REQUEST = 'admin/fetchAdminHomeRequest';
export const FETCH_ADMIN_HOME_SUCCESS = 'admin/fetchAdminHomeSuccess';
export const FETCH_ADMIN_HOME_ERROR = 'admin/fetchAdminHomeError';

export const UPDATE_STATUS_REQUEST = 'admin/updateStatusRequest';
export const UPDATE_STATUS_SUCCESS = 'admin/updateStatusSuccess';
export const UPDATE_STATUS_ERROR = 'admin/updateStatusError';
export const UPDATE_STATUS_RESET = 'admin/updateStatusReset';

export interface FetchAdminHomePayload {
    userId: string;
    role: string;
}

export interface FetchAdminHomeRequestAction {
    type: typeof FETCH_ADMIN_HOME_REQUEST;
    payload: FetchAdminHomePayload;
}

export interface FetchAdminHomeSuccessAction {
    type: typeof FETCH_ADMIN_HOME_SUCCESS;
    payload: any; // backend response data
}

export interface FetchAdminHomeErrorAction {
    type: typeof FETCH_ADMIN_HOME_ERROR;
    payload: string;
}

export interface UpdateStatusPayload {
    complaintId: string | number;
    formData: FormData;
    userId: string;
    role: string;
}

export interface UpdateStatusRequestAction {
    type: typeof UPDATE_STATUS_REQUEST;
    payload: UpdateStatusPayload;
}

export interface UpdateStatusSuccessAction {
    type: typeof UPDATE_STATUS_SUCCESS;
    payload: any;
}

export interface UpdateStatusErrorAction {
    type: typeof UPDATE_STATUS_ERROR;
    payload: string;
}

export interface UpdateStatusResetAction {
    type: typeof UPDATE_STATUS_RESET;
}

export type AdminAction =
    | FetchAdminHomeRequestAction
    | FetchAdminHomeSuccessAction
    | FetchAdminHomeErrorAction
    | UpdateStatusRequestAction
    | UpdateStatusSuccessAction
    | UpdateStatusErrorAction
    | UpdateStatusResetAction;

export const fetchAdminHomeRequest = (payload: FetchAdminHomePayload): FetchAdminHomeRequestAction => ({
    type: FETCH_ADMIN_HOME_REQUEST,
    payload,
});

export const fetchAdminHomeSuccess = (payload: any): FetchAdminHomeSuccessAction => ({
    type: FETCH_ADMIN_HOME_SUCCESS,
    payload,
});

export const fetchAdminHomeError = (error: string): FetchAdminHomeErrorAction => ({
    type: FETCH_ADMIN_HOME_ERROR,
    payload: error,
});

export const updateStatusRequest = (payload: UpdateStatusPayload): UpdateStatusRequestAction => ({
    type: UPDATE_STATUS_REQUEST,
    payload,
});

export const updateStatusSuccess = (payload: any): UpdateStatusSuccessAction => ({
    type: UPDATE_STATUS_SUCCESS,
    payload,
});

export const updateStatusError = (error: string): UpdateStatusErrorAction => ({
    type: UPDATE_STATUS_ERROR,
    payload: error,
});

export const updateStatusReset = (): UpdateStatusResetAction => ({
    type: UPDATE_STATUS_RESET,
});

