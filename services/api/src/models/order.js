const mongoose = require('mongoose');
const validator = require('validator');

const lineItemSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, match: /^[A-Z0-9-]{4,32}$/ },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true },
    customerEmail: {
      type: String,
      required: true,
      lowercase: true,
      validate: { validator: (v) => validator.isEmail(v), message: 'customerEmail must be a valid email' },
    },
    status: {
      type: String,
      enum: ['pending', 'label_created', 'in_transit', 'delivered', 'cancelled'],
      default: 'pending',
    },
    destination: {
      country: { type: String, required: true, validate: (v) => validator.isISO31661Alpha2(v) },
      postcode: { type: String, required: true },
    },
    items: { type: [lineItemSchema], validate: (v) => Array.isArray(v) && v.length > 0 },
    trackingNumber: String,
  },
  { timestamps: true }
);

orderSchema.virtual('total').get(function total() {
  return this.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
});

orderSchema.set('toJSON', { virtuals: true, versionKey: false });

module.exports = mongoose.models.Order || mongoose.model('Order', orderSchema);
