-- Expand the preference constraint without changing existing choices or NULL defaults.
ALTER TABLE users DROP CONSTRAINT users_lang_check;
ALTER TABLE users ADD CONSTRAINT users_lang_check CHECK (lang IN ('ko', 'uk', 'en'));
