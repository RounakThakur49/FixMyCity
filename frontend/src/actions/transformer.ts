// =============================================================================
// transformer.ts — Registration form payload → backend API payload
// =============================================================================
// Registration is CITIZEN-ONLY. Admins are created exclusively by the Super Admin
// via the usage analytics dashboard. There is no public admin registration path.
// =============================================================================

/** The only registerable role in the public UI. */
export type UserRole = 'citizen';

/**
 * Raw payload produced by the Registration component.
 * Field names mirror what `handleRegister` collects from the form.
 */
export interface RegisterFormPayload {
    firstName:       string;
    lastName:        string;
    email:           string;
    phone:           string;
    password:        string;
    confirmPassword: string;
    aadharNumber?:   string;   // 12-digit Aadhaar number
}

/**
 * Exact payload the backend POST /api/auth/register API consumes.
 * Backend fields: { name, phone, aadhar, email, password }
 */
export interface RegisterApiPayload {
    name:     string;
    phone:    string;
    aadhar:   string;
    email:    string;
    password: string;
    // Legacy fields kept for backward compat with auth.saga postRegister call
    firstName?: string;
    lastName?:  string;
    aadharNumber?: string;
}

export class RegisterTransformError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RegisterTransformError';
    }
}

/**
 * Validates and maps a registration form payload to the backend API payload.
 *
 * Rules:
 *  - password must match confirmPassword.
 *  - Aadhaar number must be exactly 12 digits.
 *  - phone is mapped to phone (no renaming needed).
 *
 * Throws RegisterTransformError when validation fails.
 */
export function transformRegisterPayload(form: RegisterFormPayload): RegisterApiPayload {
    if (form.password !== form.confirmPassword) {
        throw new RegisterTransformError('Password and confirm password do not match.');
    }

    const aadhar = (form.aadharNumber ?? '').trim();
    if (!aadhar || !/^\d{12}$/.test(aadhar)) {
        throw new RegisterTransformError('Aadhaar number must be exactly 12 digits.');
    }

    return {
        name:         `${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
        firstName:    form.firstName.trim(),
        lastName:     form.lastName.trim(),
        phone:        form.phone.trim(),
        aadhar,
        aadharNumber: aadhar,
        email:        form.email.trim(),
        password:     form.password,
    };
}
