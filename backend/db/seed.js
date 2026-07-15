const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');
const User = require('../models/User');
const Complaint = require('../models/Complaint');
const Review = require('../models/Review');

async function seedDatabase() {
  try {
    // ------------------------------------------------------------------
    // Seed the superadmin (one root account, never registerable through
    // the public registration form). Login email + password come from env
    // vars (SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD) so creds are not in code.
    // OTP is sent via Brevo to that email — Brevo SMTP creds must be set.
    // ------------------------------------------------------------------
    const superadminExists = await Admin.findOne({ role: 'superadmin' });
    if (!superadminExists) {
      const saEmail = process.env.SUPERADMIN_EMAIL || 'debmalyobarman2003@gmail.com';
      const saPassword = process.env.SUPERADMIN_PASSWORD || 'SuperAdmin@2024';
      const hash = await bcrypt.hash(saPassword, 12);
      await new Admin({
        name:     'Super Admin',
        username: 'superadmin',
        email:    saEmail,
        password: hash,
        role:     'superadmin',
      }).save();
      console.log(`[seed] Superadmin seeded  (login: ${saEmail})`);
    }

    // ------------------------------------------------------------------
    // Seed a default admin (created "by" the system seed, not a real user)
    // Login: username = admin@fixmycity | password = admin123
    // ------------------------------------------------------------------
    const adminExists = await Admin.findOne({ role: 'admin' });
    if (!adminExists) {
      const hash = await bcrypt.hash('admin123', 12);
      await new Admin({
        name:     'City Admin',
        username: 'admin@fixmycity',
        email:    'admin@fixmycity.in',
        password: hash,
        role:     'admin',
      }).save();
      console.log('[seed] Admin seeded  (login: admin@fixmycity / rounak123)');
    }

    // ------------------------------------------------------------------
    // Seed citizen accounts
    // Login: phone = 9876543210 | password = citizen123
    //        phone = 9123456780 | password = citizen123
    // ------------------------------------------------------------------
    if ((await User.countDocuments()) === 0) {
      const hash = await bcrypt.hash('citizen123', 12);
      await User.insertMany([
        {
          name: 'Aarav Sen',
          phone: '9876543210',
          aadhar: '123412341234',
          email: 'aarav.sen@example.com',
          password: hash,
          role: 'citizen',
        },
        {
          name: 'Diya Kapoor',
          phone: '9123456780',
          aadhar: '987698769876',
          email: 'diya.kapoor@example.com',
          password: hash,
          role: 'citizen',
        },
      ]);
      console.log('[seed] Citizens seeded.');
    }

    // ------------------------------------------------------------------
    // Seed sample complaints
    // ------------------------------------------------------------------
    if ((await Complaint.countDocuments()) === 0) {
      await Complaint.insertMany([
        {
          id: 'CMP-2401',
          citizenName: 'Aarav Sen',
          citizenPhone: '9876543210',
          title: 'Large potholes near market road',
          type: 'Potholes',
          location: 'MG Road, near City Market Gate 2',
          citizenLocation: 'Flat 402, Block A, Green Meadows, Bangalore',
          description: 'Two deep potholes are causing traffic jams and bike skids during evening hours.',
          status: 'In Review',
          forwardedTo: 'Road Maintenance Cell',
          updatedAt: '2026-06-08 10:30',
          createdAt: '2026-06-07 18:45',
          latitude: 12.9748,
          longitude: 77.6087,
          image: 'https://images.unsplash.com/photo-1518391846015-55a9cc003b25?auto=format&fit=crop&w=900&q=80',
          images: ['https://images.unsplash.com/photo-1518391846015-55a9cc003b25?auto=format&fit=crop&w=900&q=80'],
          updates: [
            { label: 'Submitted', note: 'Complaint registered by citizen.', at: '2026-06-07 18:45' },
            { label: 'In Review', note: 'Area inspection requested by admin.', at: '2026-06-08 10:30' },
          ],
        },
        {
          id: 'CMP-2402',
          citizenName: 'Diya Kapoor',
          citizenPhone: '9123456780',
          title: 'Overflowing roadside drain',
          type: 'Drainage problem',
          location: 'Lake View Colony, Block B',
          citizenLocation: 'Villa 12, Lake View Colony, Bangalore',
          description: 'Drain water is overflowing onto the road and creating a strong smell near the school entrance.',
          status: 'Forwarded',
          forwardedTo: 'Drainage and Sanitation Department',
          updatedAt: '2026-06-08 09:10',
          createdAt: '2026-06-06 14:20',
          latitude: 12.9848,
          longitude: 77.6187,
          image: 'https://images.unsplash.com/photo-1527482797697-8795b05a13fe?auto=format&fit=crop&w=900&q=80',
          images: ['https://images.unsplash.com/photo-1527482797697-8795b05a13fe?auto=format&fit=crop&w=900&q=80'],
          updates: [
            { label: 'Submitted', note: 'Complaint registered by citizen.', at: '2026-06-06 14:20' },
            { label: 'In Review', note: 'Ward office reviewed the complaint.', at: '2026-06-07 11:00' },
            { label: 'Forwarded', note: 'Issue forwarded to Drainage and Sanitation Department.', at: '2026-06-08 09:10' },
          ],
        },
        {
          id: 'CMP-2403',
          citizenName: 'Aarav Sen',
          citizenPhone: '9876543210',
          title: 'Broken streetlight causing accidents at night',
          type: 'Broken street light problem',
          location: 'Nehru Circle, Block C, Bangalore',
          citizenLocation: 'Flat 402, Block A, Green Meadows, Bangalore',
          description: 'Three consecutive streetlights are non-functional, making the stretch very dangerous after 9 PM.',
          status: 'Submitted',
          forwardedTo: '',
          updatedAt: '2026-06-09 08:00',
          createdAt: '2026-06-09 07:55',
          latitude: 12.9769,
          longitude: 77.5931,
          images: [],
          updates: [
            { label: 'Submitted', note: 'Complaint registered by citizen.', at: '2026-06-09 07:55' },
          ],
        },
      ]);
      console.log('[seed] Complaints seeded.');
    }

    // ------------------------------------------------------------------
    // Seed testimonial reviews
    // ------------------------------------------------------------------
    if ((await Review.countDocuments()) === 0) {
      await Review.insertMany([
        {
          name: 'Maria Chen',
          role: 'Resident, Portland',
          quote: 'Reported a pothole on my street Monday morning. By Thursday it was filled. I was genuinely shocked at how fast it worked.',
          avatar: 'MC',
          rating: 5,
        },
        {
          name: 'David Okafor',
          role: 'Community Organizer, Austin',
          quote: 'FixMyCity turned our neighborhood association into a real force. We documented 40 broken streetlights in one evening. All fixed within a month.',
          avatar: 'DO',
          rating: 5,
        },
        {
          name: 'Rosa Medina',
          role: 'City Council Aide, Denver',
          quote: 'From the government side — the prioritized reports make our job so much easier. We see what matters most to residents instantly.',
          avatar: 'RM',
          rating: 5,
        },
      ]);
      console.log('[seed] Reviews seeded.');
    }
  } catch (error) {
    console.error('[seed] Error seeding database:', error);
  }
}

module.exports = { seedDatabase };
