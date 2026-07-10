const mongoose = require('mongoose');

const UpdateSchema = new mongoose.Schema({
  label: {
    type: String,
    required: true,
  },
  note: {
    type: String,
    required: true,
  },
  at: {
    type: String,
    required: true,
  },
}, { _id: false });

const ImageCheckSchema = new mongoose.Schema({
  model: {
    type: String,
    default: 'none',
  },
  matched: {
    type: Boolean,
    default: null,
  },
  blocked: {
    type: Boolean,
    default: false,
  },
  score: {
    type: Number,
    default: null,
  },
  classProbs: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  clipScores: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  clipSuggestion: {
    type: String,
    default: null,
  },
  clipOodScore: {
    type: Number,
    default: null,
  },
  note: {
    type: String,
    default: '',
  },
  at: {
    type: String,
    default: '',
  },
}, { _id: false });

const ComplaintSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
  },
  citizenName: {
    type: String,
    required: true,
    maxlength: 200,
  },
  citizenPhone: {
    type: String,
    required: true,
    maxlength: 20,
  },
  citizenLocation: {
    type: String,
    default: '',
    maxlength: 500,
  },
  title: {
    type: String,
    required: true,
    maxlength: 300,
  },
  type: {
    type: String,
    required: true,
    maxlength: 100,
    // Category drives ML routing (CATEGORY_TO_CLASS in server.js). Constrain to
    // the known set so a typo can't silently skip validation / break routing.
    enum: [
      'Broken street light problem',
      'Potholes',
      'Drainage problem',
      'Others',
    ],
  },
  location: {
    type: String,
    required: true,
    maxlength: 500,
  },
  description: {
    type: String,
    required: true,
    maxlength: 5000,
  },
  status: {
    type: String,
    enum: ['Submitted', 'In Review', 'Forwarded', 'Resolved'],
    default: 'Submitted',
  },
  forwardedTo: {
    type: String,
    default: '',
  },
  image: {
    type: String,
    default: '',
  },
  images: {
    type: [String],
    default: [],
    // Base64 images live inline in the BSON doc (16MB hard cap). At ~800x800
    // JPEG q70 (~60-120KB each) a handful is fine, but an unbounded array can
    // blow the document limit and hard-fail the save. Cap defensively.
    validate: {
      validator: arr => !Array.isArray(arr) || arr.length <= 6,
      message: 'A complaint can have at most 6 images.',
    },
  },
  updates: {
    type: [UpdateSchema],
    default: [],
  },
  imageCheck: {
    type: ImageCheckSchema,
    default: () => ({}),
  },
  latitude: {
    type: Number,
    default: null,
  },
  longitude: {
    type: Number,
    default: null,
  },
  createdAt: {
    type: String,
    required: true,
  },
  updatedAt: {
    type: String,
    required: true,
  },
  isReviewed: {
    type: Boolean,
    default: false,
  },
});

// -----------------------------------------------------------------------------
// Indexes — the common access patterns are: list sorted by updatedAt desc,
// filter by status (stats), and point-lookups by the human-facing `id`.
// Without these, each query is a full collection scan + in-memory sort, which
// breaks past ~tens of thousands of docs (MongoDB's 32MB in-memory sort cap).
// `id` already gets a unique index from the field definition above.
// -----------------------------------------------------------------------------
ComplaintSchema.index({ updatedAt: -1 });
ComplaintSchema.index({ status: 1 });
ComplaintSchema.index({ citizenPhone: 1 });

module.exports = mongoose.model('Complaint', ComplaintSchema);
