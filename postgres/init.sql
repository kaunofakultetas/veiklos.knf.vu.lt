-- Every point in time is TIMESTAMPTZ: the database runs on
-- Vilnius time and the backend on UTC, and only an instant
-- stored with its zone reads back the same on both sides

-- Users
CREATE TABLE IF NOT EXISTS users (
    eid           VARCHAR PRIMARY KEY,
    email         VARCHAR UNIQUE NOT NULL,
    full_name     VARCHAR,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

-- Roles catalog
CREATE TABLE IF NOT EXISTS roles (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR UNIQUE NOT NULL,
    description VARCHAR
);

-- User ↔ role assignments
CREATE TABLE IF NOT EXISTS user_roles (
    user_eid    VARCHAR   NOT NULL REFERENCES users(eid) ON DELETE CASCADE,
    role_id     INTEGER   NOT NULL REFERENCES roles(id)  ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_eid, role_id)
);

-- Sessions (express-session through backend db/sessionStore.js):
-- the serialized session (cookie + the SAML login) and when it
-- ends; expired rows are ignored and swept by the backend. The
-- two expression indexes serve single logout, which finds a
-- login by the SessionIndex / NameID the IdP quotes
CREATE TABLE IF NOT EXISTS session (
    sid    VARCHAR PRIMARY KEY,
    sess   JSONB NOT NULL,
    expire TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS session_expire_idx ON session (expire);
CREATE INDEX IF NOT EXISTS session_login_index_idx ON session ((sess->'samlUser'->>'sessionIndex'));
CREATE INDEX IF NOT EXISTS session_login_nameid_idx ON session ((sess->'samlUser'->>'nameID'));

-- Login assertions already used (backend routes/saml.js):
-- an assertion's ID stays until the assertion itself expires,
-- so posting the same one again signs nobody in a second
-- time; expired rows are swept at the next login
CREATE TABLE IF NOT EXISTS saml_assertions (
    id     VARCHAR PRIMARY KEY,
    expire TIMESTAMPTZ NOT NULL
);

-- Activity themes, each code used once; a theme has no point
-- value until the committee's calculation stores one
CREATE TABLE IF NOT EXISTS themes (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR NOT NULL UNIQUE,
    title       VARCHAR NOT NULL,
    total_sum   NUMERIC DEFAULT 0,
    pointvalue  NUMERIC
);

-- Subthemes
CREATE TABLE IF NOT EXISTS subthemes (
    id          SERIAL PRIMARY KEY,
    theme_id    INTEGER NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    code        VARCHAR NOT NULL,
    title       VARCHAR NOT NULL,
    description TEXT,
    cap         NUMERIC,
    -- lets activities reference the (subtheme, theme) PAIR
    UNIQUE (id, theme_id),
    -- a code is used once within its theme; two theme
    -- families number their subthemes alike, so the same code
    -- appears under both
    UNIQUE (theme_id, code)
);

-- Activities
CREATE TABLE IF NOT EXISTS activities (
    id                       SERIAL PRIMARY KEY,
    employee_eid             VARCHAR NOT NULL REFERENCES users(eid) ON DELETE CASCADE,
    theme_id                 INTEGER NOT NULL REFERENCES themes(id),
    subtheme_id              INTEGER NOT NULL REFERENCES subthemes(id),
    title                    VARCHAR NOT NULL,
    description              TEXT,
    status                   VARCHAR NOT NULL DEFAULT 'PATEIKTA',
    rejection_comment        TEXT,
    manager_comments         TEXT,
    committee_comments       TEXT,
    score                    NUMERIC,
    attachment_path          VARCHAR,
    attachment_original_name VARCHAR,
    created_at               TIMESTAMPTZ DEFAULT NOW(),
    updated_at               TIMESTAMPTZ DEFAULT NOW(),
    -- the subtheme must belong to the theme (the backend checks
    -- this too, so the error stays friendly)
    FOREIGN KEY (subtheme_id, theme_id) REFERENCES subthemes (id, theme_id)
);

-- Seed default roles
INSERT INTO roles (name, description) VALUES
    ('Darbuotojas',    'Darbuotojas – gali teikti veiklas'),
    ('Vadybininkas',   'Vadybininkas – gali peržiūrėti ir valdyti veiklas'),
    ('Komisijos narys','Komisijos narys – gali vertinti veiklas')
ON CONFLICT (name) DO NOTHING;
