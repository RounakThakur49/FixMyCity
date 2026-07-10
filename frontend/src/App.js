import { useEffect, useMemo, useState } from 'react';
import './App.css';
import { validateAadhaar } from './aadhaar';
import Header from './components/Header';
import Hero from './components/Hero';
import CitizenDashboard from './components/CitizenDashboard';
import AdminDashboard from './components/AdminDashboard';

// ─── Constants ────────────────────────────────────────────────────────────────

const SESSION_KEY = 'fixmycity-session';

const getApiBaseUrl = () => {
  const stored = localStorage.getItem('fixmycity-api-url');
  if (stored) return stored;
  return process.env.REACT_APP_API_URL || 'http://localhost:5000';
};
const API_BASE_URL = getApiBaseUrl();

export const complaintTypes = [
  'Broken street light problem',
  'Potholes',
  'Drainage problem',
  'Others',
];

export const authorityOptions = [
  'Municipal Engineering Department',
  'Road Maintenance Cell',
  'Drainage and Sanitation Department',
  'Ward Office',
];

const EMPTY_COMPLAINT_FORM = {
  title: '',
  type: complaintTypes[0],
  location: '',
  citizenLocation: '',
  description: '',
  images: [],
  latitude: null,
  longitude: null,
};

const EMPTY_LOGIN_FORM = { phone: '', password: '' };
const EMPTY_REGISTER_FORM = { name: '', phone: '', aadhar: '', email: '', password: '' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

async function fetchComplaints() {
  const res = await fetch(`${API_BASE_URL}/api/complaints`, {
    headers: { 'ngrok-skip-browser-warning': 'true' }
  });
  if (!res.ok) throw new Error('Failed to fetch complaints');
  return res.json();
}

async function fetchReviews() {
  const res = await fetch(`${API_BASE_URL}/api/reviews`, {
    headers: { 'ngrok-skip-browser-warning': 'true' }
  });
  if (!res.ok) throw new Error('Failed to fetch reviews');
  return res.json();
}

// ─── App ──────────────────────────────────────────────────────────────────────

function App() {
  const [portal, setPortal] = useState('citizen');
  const [citizenMode, setCitizenMode] = useState('login');
  const [complaints, setComplaints] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [session, setSession] = useState(readSession);
  const [authMessage, setAuthMessage] = useState('');
  const [registerForm, setRegisterForm] = useState(EMPTY_REGISTER_FORM);
  const [loginForm, setLoginForm] = useState(EMPTY_LOGIN_FORM);
  const [complaintForm, setComplaintForm] = useState(EMPTY_COMPLAINT_FORM);
  const [selectedComplaintId, setSelectedComplaintId] = useState('');
  const [complaintError, setComplaintError] = useState(null);
  const [registeredCitizensCount, setRegisteredCitizensCount] = useState(0);

  const changeApiUrl = () => {
    const current = localStorage.getItem('fixmycity-api-url') || process.env.REACT_APP_API_URL || 'http://localhost:5000';
    const newUrl = prompt("Enter Backend Server API URL (e.g. http://192.168.1.15:5000 or https://your-backend.onrender.com):", current);
    if (newUrl !== null) {
      const trimmed = newUrl.trim();
      if (trimmed === '') {
        localStorage.removeItem('fixmycity-api-url');
      } else {
        localStorage.setItem('fixmycity-api-url', trimmed.replace(/\/$/, "")); // Trim trailing slash
      }
      window.location.reload();
    }
  };

  const changeGoogleMapsApiKey = () => {
    const current = localStorage.getItem('fixmycity-google-maps-api-key') || process.env.REACT_APP_GOOGLE_MAPS_API_KEY || '';
    const newKey = prompt("Enter Google Maps API Key (leave blank for development mode):", current);
    if (newKey !== null) {
      const trimmed = newKey.trim();
      if (trimmed === '') {
        localStorage.removeItem('fixmycity-google-maps-api-key');
      } else {
        localStorage.setItem('fixmycity-google-maps-api-key', trimmed);
      }
      window.location.reload();
    }
  };

  // Authorization header for write routes. Reads stay public. `session.token`
  // is the JWT issued at login/register and persisted with the session.
  const authHeaders = () =>
    session?.token ? { Authorization: `Bearer ${session.token}` } : {};

  // A 401 on a write means the token is missing/expired — force a clean re-login
  // instead of leaving the user in a half-broken state.
  const handleExpiredSession = () => {
    setSession(null);
    alert('Your session has expired. Please log in again.');
  };

  const updateProfile = async (updatedData) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/update-profile`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
          ...authHeaders(),
        },
        body: JSON.stringify(updatedData)
      });
      if (res.status === 401) {
        handleExpiredSession();
        return { success: false, message: 'Session expired. Please log in again.' };
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to update profile.');
      }
      // Preserve the existing token — update-profile returns the user only.
      setSession((prev) => ({ ...data.user, token: prev?.token }));
      return { success: true };
    } catch (err) {
      console.error('Update profile error:', err);
      return { success: false, message: err.message };
    }
  };

  // ── Bootstrap complaints and reviews on mount ──────────────────────────────
  useEffect(() => {
    fetchComplaints()
      .then((data) => {
        setComplaints(data);
        if (data.length > 0) setSelectedComplaintId(data[0].id);
      })
      .catch((err) => console.error('Error fetching complaints:', err));

    fetchReviews()
      .then((data) => {
        setReviews(data);
      })
      .catch((err) => console.error('Error fetching reviews:', err));

    refreshStats();
  }, []);

  // ── Persist session ────────────────────────────────────────────────────────
  useEffect(() => {
    if (session) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  }, [session]);

  // ── Derived state ──────────────────────────────────────────────────────────
  const currentCitizenComplaints = useMemo(
    () =>
      session?.role === 'citizen'
        ? complaints.filter((c) => c.citizenPhone === session.phone)
        : [],
    [complaints, session]
  );

  const selectedComplaint = useMemo(() => {
    // Citizens may only fall back to their own complaints; admins see all.
    const scope =
      session?.role === 'citizen' ? currentCitizenComplaints : complaints;
    return scope.find((c) => c.id === selectedComplaintId) ?? scope[0];
  }, [complaints, currentCitizenComplaints, selectedComplaintId, session]);

  const stats = useMemo(() => {
    return {
      total: complaints.length,
      active: complaints.filter((c) => c.status !== 'Resolved').length,
      resolved: complaints.filter((c) => c.status === 'Resolved').length,
      citizens: registeredCitizensCount || new Set(complaints.map((c) => c.citizenPhone)).size,
    };
  }, [complaints, registeredCitizensCount]);

  // ── Auth helpers ───────────────────────────────────────────────────────────
  function resetAuthForms() {
    setAuthMessage('');
    setLoginForm(EMPTY_LOGIN_FORM);
    setRegisterForm(EMPTY_REGISTER_FORM);
  }

  async function refreshStats() {
    try {
      const res = await fetch(`${API_BASE_URL}/api/stats`, {
        headers: { 'ngrok-skip-browser-warning': 'true' }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.registeredCitizens === 'number') {
          setRegisteredCitizensCount(data.registeredCitizens);
        }
      }
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  }

  async function refreshComplaints() {
    try {
      const data = await fetchComplaints();
      setComplaints(data);
      if (data.length > 0 && !data.some((c) => c.id === selectedComplaintId)) {
        setSelectedComplaintId(data[0].id);
      }
      refreshStats();
    } catch (err) {
      console.error('Error refreshing complaints:', err);
    }
  }

  // ── Consolidated login (citizen + admin) ───────────────────────────────────
  async function handleLogin(event, requiredRole) {
    event.preventDefault();
    setAuthMessage('');

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify({
          identifier: loginForm.phone.trim(),
          phone: loginForm.phone.trim(),
          password: loginForm.password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setAuthMessage(data.message || 'Invalid credentials.');
        return;
      }

      if (requiredRole === 'admin' && data.user.role !== 'admin') {
        setAuthMessage('Access denied. Admin credentials required.');
        return;
      }

      setSession({ ...data.user, token: data.token });
      await refreshComplaints();
    } catch (err) {
      console.error('Login error:', err);
      setAuthMessage('Could not connect to database server.');
    }
  }

  const handleCitizenLogin = (e) => handleLogin(e, 'citizen');
  const handleAdminLogin = (e) => handleLogin(e, 'admin');

  async function handleCitizenRegister(event) {
    event.preventDefault();
    setAuthMessage('');

    const aadhaarCheck = validateAadhaar(registerForm.aadhar.trim());
    if (!aadhaarCheck.valid) {
      setAuthMessage(aadhaarCheck.message);
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify({
          name: registerForm.name.trim(),
          phone: registerForm.phone.trim(),
          aadhar: registerForm.aadhar.trim(),
          email: registerForm.email.trim(),
          password: registerForm.password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setAuthMessage(data.message || 'Registration failed.');
        return;
      }

      setCitizenMode('login');
      setRegisterForm(EMPTY_REGISTER_FORM);
      setAuthMessage('Registration successful! Please log in.');
      refreshStats();
    } catch (err) {
      console.error('Register error:', err);
      setAuthMessage('Could not connect to database server.');
    }
  }

  // Helper to compress images on client side
  function compressImage(base64Str, maxWidth = 800, maxHeight = 800, quality = 0.7) {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64Str;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      };
      img.onerror = () => {
        resolve(base64Str);
      };
    });
  }

  // ── Complaint handlers ─────────────────────────────────────────────────────
  function handleComplaintImages(event) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;

    let loaded = [];
    let count = 0;

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = async () => {
        if (typeof reader.result === 'string') {
          try {
            const compressed = await compressImage(reader.result);
            loaded.push(compressed);
          } catch (e) {
            loaded.push(reader.result);
          }
        }
        if (++count === files.length) {
          setComplaintForm((prev) => ({
            ...prev,
            images: [...prev.images, ...loaded],
          }));
        }
      };
      reader.readAsDataURL(file);
    });
  }

async function handleComplaintSubmit(event) {
    event.preventDefault();
    if (session?.role !== 'citizen') return false;
    setComplaintError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/complaints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
          ...authHeaders()
        },
        body: JSON.stringify({
          citizenName: session.name,
          citizenPhone: session.phone,
          citizenLocation: complaintForm.citizenLocation.trim(),
          title: complaintForm.title.trim(),
          type: complaintForm.type,
          location: complaintForm.location.trim(),
          description: complaintForm.description.trim(),
          images: complaintForm.images,
          image: complaintForm.images[0] ?? '',
          latitude: complaintForm.latitude,
          longitude: complaintForm.longitude,
        }),
      });

      if (res.status === 401) {
        handleExpiredSession();
        return false;
      }
      if (!res.ok) {
        const data = await res.json();
        // HTTP 422 = image blocked by AI classifier
        if (res.status === 422 && data.blocked) {
          if (data.reason === 'inappropriate_content') {
            setComplaintError({
              kind: 'nsfw',
              message: data.message,
              suggestion: data.suggestion || '',
            });
          } else {
            setComplaintError({
              kind: 'mismatch',
              message: data.message,
              suggestion: data.suggestion || '',
              detected: data.aiDetails?.topClass || '',
              declared: data.aiDetails?.declaredClass || '',
              confidence: (data.aiDetails?.topConfidence || 0) / 100,
              declaredConfidence: (data.aiDetails?.declaredConfidence || 0) / 100,
              probs: data.aiDetails?.allScores || {},
              block_reason: data.aiDetails?.reason || '',
            });
          }
        } else {
          setComplaintError({
            kind: 'generic',
            message: data.message || 'Failed to submit complaint.',
          });
        }
        return false;
      }

      const newComplaint = await res.json();
      setComplaints((prev) => [newComplaint, ...prev]);
      setSelectedComplaintId(newComplaint.id);
      setComplaintForm(EMPTY_COMPLAINT_FORM);
      setComplaintError(null);
      return true;
    } catch (err) {
      console.error('Submit complaint error:', err);
      setComplaintError({
        kind: 'generic',
        message: 'Could not connect to server.',
      });
      return false;
    }
  }

  async function handleStatusChange(complaintId, nextStatus, forwardedTo) {
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/complaints/${complaintId}/status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true',
            ...authHeaders()
          },
          body: JSON.stringify({ status: nextStatus, forwardedTo }),
        }
      );

      if (res.status === 401 || res.status === 403) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) handleExpiredSession();
        else alert(data.message || 'Admin privileges required.');
        return;
      }
      if (!res.ok) {
        const data = await res.json();
        alert(data.message || 'Failed to update status.');
        return;
      }

      const updated = await res.json();
      setComplaints((prev) =>
        prev.map((c) => (c.id === complaintId ? updated : c))
      );
    } catch (err) {
      console.error('Update status error:', err);
      alert('Could not connect to database server.');
    }
  }

  async function handleComplaintDelete(complaintId) {
    if (!window.confirm('Are you sure you want to delete this complaint?')) return;

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/complaints/${complaintId}`,
        {
          method: 'DELETE',
          headers: { 'ngrok-skip-browser-warning': 'true', ...authHeaders() }
        }
      );

      if (res.status === 401 || res.status === 403) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) handleExpiredSession();
        else alert(data.message || 'Admin privileges required.');
        return;
      }
      if (!res.ok) {
        const data = await res.json();
        alert(data.message || 'Failed to delete complaint.');
        return;
      }

      setComplaints((prev) => {
        const remaining = prev.filter((c) => c.id !== complaintId);
        if (remaining.length > 0) setSelectedComplaintId(remaining[0].id);
        else setSelectedComplaintId('');
        return remaining;
      });
    } catch (err) {
      console.error('Delete complaint error:', err);
      alert('Could not connect to database server.');
    }
  }

  async function handleReviewSubmit(reviewData) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
          ...authHeaders()
        },
        body: JSON.stringify(reviewData),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.message || 'Failed to submit review.');
        return false;
      }

      const newReview = await res.json();
      setReviews((prev) => [newReview, ...prev]);

      // Update the complaint locally to be reviewed
      if (reviewData.complaintId) {
        setComplaints((prev) =>
          prev.map((c) => (c.id === reviewData.complaintId ? { ...c, isReviewed: true } : c))
        );
      }
      return true;
    } catch (err) {
      console.error('Submit review error:', err);
      alert('Could not connect to database server.');
      return false;
    }
  }

  function logout() {
    setSession(null);
    resetAuthForms();
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="app-shell">
      {session && (
        <Header 
          portal={portal} 
          setPortal={setPortal} 
          session={session} 
          logout={logout} 
          changeGoogleMapsApiKey={changeGoogleMapsApiKey} 
          updateProfile={updateProfile}
        />
      )}

      <main className={`page-content ${session?.role === 'admin' ? 'admin-page-content' : ''}`}>
        {session?.role === 'citizen' ? (
          <CitizenDashboard
            session={session}
            logout={logout}
            currentCitizenComplaints={currentCitizenComplaints}
            selectedComplaintId={selectedComplaintId}
            setSelectedComplaintId={setSelectedComplaintId}
            selectedComplaint={selectedComplaint}
            complaintForm={complaintForm}
            setComplaintForm={setComplaintForm}
            complaintTypes={complaintTypes}
            handleComplaintImages={handleComplaintImages}
            handleComplaintSubmit={handleComplaintSubmit}
            handleReviewSubmit={handleReviewSubmit}
            complaintError={complaintError}
            setComplaintError={setComplaintError}
          />
        ) : session?.role === 'admin' ? (
          <AdminDashboard
            stats={stats}
            logout={logout}
            complaints={complaints}
            selectedComplaintId={selectedComplaintId}
            setSelectedComplaintId={setSelectedComplaintId}
            selectedComplaint={selectedComplaint}
            handleStatusChange={handleStatusChange}
            handleComplaintDelete={handleComplaintDelete}
            authorityOptions={authorityOptions}
          />
        ) : (
          <Hero
            portal={portal}
            setPortal={setPortal}
            citizenMode={citizenMode}
            setCitizenMode={setCitizenMode}
            stats={stats}
            authMessage={authMessage}
            loginForm={loginForm}
            setLoginForm={setLoginForm}
            registerForm={registerForm}
            setRegisterForm={setRegisterForm}
            handleCitizenLogin={handleCitizenLogin}
            handleCitizenRegister={handleCitizenRegister}
            handleAdminLogin={handleAdminLogin}
            resetAuthForms={resetAuthForms}
            complaints={complaints}
            changeApiUrl={changeApiUrl}
            reviews={reviews}
          />
        )}
      </main>
    </div>
  );
}

export default App;