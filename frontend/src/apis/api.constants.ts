// =============================================================================
// api.constants.ts — All API endpoint paths aligned with our Express backend
// =============================================================================
// The Vite dev server proxies /api/* → http://localhost:5000
// All paths below MUST start with /api to be correctly proxied.
// =============================================================================

export const BASE_URL = ''; // Vite proxy handles the host; no base URL needed

export class APIConstants {
    AUTH = {
        LOGIN:      `/api/auth/login`,
        REGISTER:   `/api/auth/register`,
        VERIFY_OTP: `/api/auth/verify-otp`,
        UPDATE_PROFILE: `/api/auth/update-profile`,
    };

    USERS = {
        // GET /api/complaints?citizenPhone=xxx&page=1&limit=20
        GET_USER_HOME:             `/api/complaints`,
        // POST /api/complaints  (JSON body)
        REGISTER_USER_COMPLAINTS:  `/api/complaints`,
        // GET /api/complaints/:id
        GET_COMPLAINT_DETAILS: (complaintId: string | number) =>
            `/api/complaints/${complaintId}`,
    };

    ADMIN = {
        // GET /api/complaints   (admins see all)
        GET_ADMIN_HOME:             `/api/complaints`,
        // GET /api/complaints/:id
        GET_COMPLAINT_DETAILS: (complaintId: string | number) =>
            `/api/complaints/${complaintId}`,
        // PATCH /api/complaints/:id/status
        ADMIN_UPDATE_COMPLAINTS_STATUS: (complaintId: string | number) =>
            `/api/complaints/${complaintId}/status`,
    };

    SUPERADMIN = {
        GET_STATS:    `/api/superadmin/stats`,
        GET_ADMINS:   `/api/superadmin/admins`,
        CREATE_ADMIN: `/api/superadmin/admins`,
        DELETE_ADMIN: (id: string) => `/api/superadmin/admins/${id}`,
        GET_ADMIN_ACTIVITY: (id: string) =>
            `/api/superadmin/admins/${id}/activity`,
        GET_CITIZENS: `/api/superadmin/citizens`,
        GET_CITIZEN_ACTIVITY: (id: string) =>
            `/api/superadmin/citizens/${id}/activity`,
    };

    STATS = {
        PUBLIC: `/api/stats`,
    };
}