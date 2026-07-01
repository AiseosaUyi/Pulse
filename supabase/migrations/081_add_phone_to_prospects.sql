-- Add phone number field to prospects for direct contact / WhatsApp outreach.
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS phone TEXT;
