-- District auto-enrollment: a student whose verified account email is already
-- on a partner district's domain is enrolled without a confirmation link.
-- Recorded distinctly from SCHOOL_EMAIL_VERIFICATION so the membership audit
-- trail can say exactly how access was granted.
ALTER TYPE "ActivationMethod" ADD VALUE IF NOT EXISTS 'DOMAIN_MATCH';
