// =============================================================================
// functions.ts — API call functions aligned with our Express backend
// =============================================================================
// All calls go through apiBaseFMCClient which auto-attaches Bearer JWT.
// The backend field names for each endpoint are documented inline.
// =============================================================================

import { apiBaseFMCClient, TOKEN_KEY } from './axios.baseClient';
import { APIConstants } from './api.constants';

const api = new APIConstants();

// ── Auth ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/register
 * Citizen self-registration. Admins are created by superadmin only.
 * Backend expects: { name, phone, aadhar, email, password }
 */
export const postRegister = async (params: {
    name?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    mobile?: string;
    aadhar?: string;
    aadharNumber?: string;
    email?: string;
    password: string;
}) => {
    // Normalise field names — accept both our backend names and fork form names
    const name   = params.name || `${params.firstName || ''} ${params.lastName || ''}`.trim();
    const phone  = params.phone || params.mobile || '';
    const aadhar = params.aadhar || params.aadharNumber || '';

    const response = await apiBaseFMCClient.post(api.AUTH.REGISTER, {
        name,
        phone,
        aadhar,
        email: params.email || '',
        password: params.password,
    });
    return response.data;
};

/**
 * POST /api/auth/login
 * Backend expects: { identifier, password, role }
 * role: 'citizen' | 'admin'  (superadmin logs in through 'admin')
 * Returns: { token, user } for citizen/admin
 *          { requiresOtp: true, pendingToken } for superadmin
 */
export const postLogin = async (params: {
    email?: string;
    identifier?: string;
    phone?: string;
    password: string;
    role: string;
}) => {
    const identifier = params.identifier || params.email || params.phone || '';
    const response = await apiBaseFMCClient.post(api.AUTH.LOGIN, {
        identifier,
        email: identifier,   // send both; backend accepts either field name
        password: params.password,
        role: params.role,
    });
    return response.data;
};

/**
 * POST /api/auth/verify-otp
 * Verifies the superadmin OTP. Uses the pendingToken as Bearer.
 * Returns: { token, user } — full superadmin JWT
 */
export const postVerifyOtp = async (params: { otp: string; pendingToken: string }) => {
    const response = await apiBaseFMCClient.post(
        api.AUTH.VERIFY_OTP,
        { otp: params.otp },
        { headers: { Authorization: `Bearer ${params.pendingToken}` } },
    );
    return response.data;
};


/** Client-side logout — clear session storage, no server call needed */
export const postLogout = async () => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem('user');
    return { success: true };
};

// ── Citizen ───────────────────────────────────────────────────────────────────

/**
 * GET /api/complaints?citizenPhone=xxx
 * Returns the citizen's own complaints.
 * Backend filters by citizenPhone extracted from the JWT + optional query param.
 */
export const getUserHome = async (params: { userId: string; role: string }) => {
    // Filter server-side by the logged-in citizen's phone so citizens only see
    // their own complaints. Admins/superadmins use getAdminHome (no filter).
    let url = api.USERS.GET_USER_HOME;
    try {
        const stored = sessionStorage.getItem('user');
        const u = stored ? (JSON.parse(stored).user || JSON.parse(stored)) : null;
        if (u?.phone) {
            url += `?citizenPhone=${encodeURIComponent(u.phone)}`;
        }
    } catch { /* no filter — backend returns all */ }

    const response = await apiBaseFMCClient.get(url);
    const data = response.data;
    const raw = Array.isArray(data) ? data : (data.data || data.complaints || []);
    const complaints = raw.map(normalizeComplaint);
    return {
        registeredComplaints: complaints,
        statusMap: buildStatusMap(complaints),
    };
};

/**
 * POST /api/complaints
 * Register a new complaint (JSON body, not multipart).
 * Backend expects: { title, type, location, description, image?, images? }
 * The JWT provides citizenName/citizenPhone from auth.sub.
 */
export const postRegisterComplaint = async (params: {
    formData: FormData;
    userId: string;
    role: string;
}) => {
    // Convert FormData to JSON for our backend
    const fd = params.formData;
    const body: Record<string, any> = {};
    fd.forEach((value, key) => {
        body[key] = value;
    });

    // Our backend hard-requires citizenName + citizenPhone (the fork derived the
    // owner from a forgeable header; we take it from the logged-in session user).
    try {
        const stored = sessionStorage.getItem('user');
        const u = stored ? (JSON.parse(stored).user || JSON.parse(stored)) : null;
        if (u) {
            if (!body.citizenName)  body.citizenName  = u.name || u.firstname || 'Citizen';
            if (!body.citizenPhone) body.citizenPhone = u.phone || u.mobile || '';
        }
    } catch { /* session unreadable — backend will 400, surfaced to user */ }

    // Alias the fork's broad municipal categories → our 4 trained ML enum values
    // (Complaint.type enum). Leaves already-correct values untouched.
    const ISSUE_TYPE_MAP: Record<string, string> = {
        'Water Supply and Drainage': 'Drainage problem',
        'Roads and infrastructure':  'Potholes',
        'Garbage and Sanitation':    'Others',
        'Others':                    'Others',
    };
    const rawType = body.type || body.issuetype || body.issueType;
    if (rawType) body.type = ISSUE_TYPE_MAP[rawType] || rawType;
    delete body.issuetype; delete body.issueType;

    // Map fork's photo/location field names → our backend's names.
    if (!body.image && body.photo) body.image = body.photo;
    if (!body.location && body.locationUrl) body.location = body.locationUrl;

    const response = await apiBaseFMCClient.post(api.USERS.REGISTER_USER_COMPLAINTS, body);
    return response.data;
};

/**
 * GET /api/complaints/:id
 */
export const getComplaintDetails = async (params: {
    complaintId: string | number;
    role: 'admin' | 'citizen' | 'superadmin';
    userId: string;
}) => {
    const response = await apiBaseFMCClient.get(
        api.USERS.GET_COMPLAINT_DETAILS(params.complaintId),
    );
    const data = response.data || {};
    const complaint = normalizeComplaint(data.complaint || data);
    // Our backend stores status history as updates[{label,note,at}] and the
    // address under `location`. The fork's detail/timeline components read
    // workstatus/title/description/dateTime and `locationUrl`. Translate here so
    // the carried-over UI renders (adapter is the single translation point).
    if (complaint && typeof complaint === 'object') {
        if (complaint.locationUrl == null) {
            complaint.locationUrl = complaint.location || complaint.locationurl || '';
        }
    }
    const rawUpdates = data.statusUpdates || (complaint && complaint.updates) || [];
    const statusUpdates = (rawUpdates as any[]).map((u) => ({
        workstatus: u.workstatus || u.label || '',
        title: u.title || u.label || '',
        description: u.description || u.note || '',
        dateTime: u.dateTime || u.at || '',
        createdAt: u.createdAt || u.at || '',
        photoUrl: u.photoUrl || '',
        ...u,
    }));
    return { ...data, complaint, statusUpdates };
};

// ── Admin ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/complaints — admin sees all complaints
 */
export const getAdminHome = async (params: { userId: string; role: string }) => {
    const response = await apiBaseFMCClient.get(api.ADMIN.GET_ADMIN_HOME);
    const data = response.data;
    const raw = Array.isArray(data) ? data : (data.data || data.complaints || []);
    const complaints = raw.map(normalizeComplaint);
    return {
        complaints,
        statusMap: buildStatusMap(complaints),
    };
};

/**
 * PATCH /api/complaints/:id/status
 * Backend expects: { status, note?, forwardedTo? }
 */
export const postUpdateStatus = async (params: {
    complaintId: string | number;
    formData: FormData;
    userId: string;
    role: string;
}) => {
    // Convert FormData → JSON for our backend
    const fd = params.formData;
    const body: Record<string, any> = {};
    fd.forEach((value, key) => {
        body[key] = value;
    });

    // Map the fork's status values to our backend enum
    const statusMap: Record<string, string> = {
        'pending':          'Submitted',
        'work-on-progress': 'In Review',
        'completed':        'Resolved',
    };
    if (body.workstatus) {
        body.status = statusMap[body.workstatus] || body.workstatus;
    }

    // Remove fields the PATCH /api/complaints/:id/status endpoint doesn't accept.
    // photo is a File object that can't serialize to JSON — strip it.
    delete body.photo;
    delete body.workstatus;

    console.log('[postUpdateStatus] complaintId:', params.complaintId, 'body:', JSON.stringify(body));

    const response = await apiBaseFMCClient.patch(
        api.ADMIN.ADMIN_UPDATE_COMPLAINTS_STATUS(params.complaintId),
        body,
    );
    return response.data;
};

// ── Superadmin ────────────────────────────────────────────────────────────────

export const getSuperadminStats = async () => {
    const response = await apiBaseFMCClient.get(api.SUPERADMIN.GET_STATS);
    return response.data;
};

export const getSuperadminAdmins = async () => {
    const response = await apiBaseFMCClient.get(api.SUPERADMIN.GET_ADMINS);
    return response.data;
};

export const postCreateAdmin = async (params: {
    name: string;
    username: string;
    email?: string;
    phone?: string;
    password: string;
}) => {
    const response = await apiBaseFMCClient.post(api.SUPERADMIN.CREATE_ADMIN, params);
    return response.data;
};

export const deleteAdmin = async (id: string) => {
    const response = await apiBaseFMCClient.delete(api.SUPERADMIN.DELETE_ADMIN(id));
    return response.data;
};

export const getSuperadminCitizens = async (page = 1, limit = 50) => {
    const response = await apiBaseFMCClient.get(
        `${api.SUPERADMIN.GET_CITIZENS}?page=${page}&limit=${limit}`,
    );
    return response.data;
};

export const getCitizenActivity = async (citizenId: string) => {
    const response = await apiBaseFMCClient.get(
        api.SUPERADMIN.GET_CITIZEN_ACTIVITY(citizenId),
    );
    return response.data;
};

// ── Legacy compat exports (used by Profile.tsx) ────────────────────────────────

/**
 * GET profile for the currently logged-in user.
 * Our backend doesn't have a separate profile GET; we rely on the user object
 * returned at login. This is a no-op that returns the current sessionStorage user.
 */
export const getProfile = async (params: { role: string; userId: string }) => {
    const stored = sessionStorage.getItem('user');
    if (stored) {
        try { return JSON.parse(stored); } catch { return null; }
    }
    return null;
};

/**
 * Profile update — wraps postUpdateProfile.
 * Accepts the fork's old { role, userId, profileData } shape.
 */
export const postUpdateProfile = async (params: {
    role?: string;
    userId?: string;
    profileData?: any;
    name?: string;
    email?: string;
    phone?: string;
}) => {
    const { profileData, ...rest } = params;
    const body = profileData || rest;
    // Map old field names to our backend's field names
    const mapped: Record<string, any> = {
        name:  body.name || (body.firstname ? `${body.firstname} ${body.lastname || ''}`.trim() : undefined),
        email: body.email,
        phone: body.phone || body.mobile,
    };
    // Remove undefined keys
    Object.keys(mapped).forEach(k => mapped[k] === undefined && delete mapped[k]);
    const response = await apiBaseFMCClient.patch('/api/auth/update-profile', mapped);
    return response.data;
};


/**
 * Normalize a backend complaint doc to the field names the fork-derived UI reads.
 * Our backend uses `type` / `image` / `location`; the carried-over components read
 * `issueType` / `photoUrl` / `locationUrl`. Add aliases without dropping originals.
 */
function normalizeComplaint(c: any): any {
    if (!c || typeof c !== 'object') return c;
    return {
        ...c,
        issueType:   c.issueType   || c.issuetype || c.type || '',
        photoUrl:    c.photoUrl     || c.image     || '',
        locationUrl: c.locationUrl  || c.location  || c.locationurl || '',
    };
}

/**
 * Build a statusMap from a complaints array:
 * { [complaintId]: { workstatus: string, ... } }
 * Used by both admin and citizen reducers.
 */
function buildStatusMap(complaints: any[]): Record<string, any> {
    const map: Record<string, any> = {};
    for (const c of complaints) {
        const id = c.id || String(c._id);
        // Map our backend enum → fork status strings for display
        const statusTranslation: Record<string, string> = {
            'Submitted':  'pending',
            'In Review':  'work-on-progress',
            'Forwarded':  'work-on-progress',
            'Resolved':   'completed',
        };
        // Surface the LATEST updates[] entry (label/note/at) under the field names
        // userHome's "Latest Status Update" panel reads (note/createdAt/title/...).
        const last = Array.isArray(c.updates) && c.updates.length
            ? c.updates[c.updates.length - 1]
            : null;
        map[id] = {
            workstatus:  statusTranslation[c.status] || 'pending',
            title:       last?.label || c.status || '',
            note:        last?.note || '',
            description: last?.note || '',
            dateTime:    last?.at || '',
            createdAt:   last?.at || '',
            complaint:   c,
        };
    }
    return map;
}
