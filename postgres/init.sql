-- Users
CREATE TABLE IF NOT EXISTS users (
    eid           VARCHAR PRIMARY KEY,
    email         VARCHAR UNIQUE NOT NULL,
    full_name     VARCHAR,
    created_at    TIMESTAMP DEFAULT NOW(),
    last_login_at TIMESTAMP
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
    assigned_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_eid, role_id)
);

-- Activity themes
CREATE TABLE IF NOT EXISTS themes (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR NOT NULL,
    title       VARCHAR NOT NULL,
    total_sum   NUMERIC DEFAULT 0,
    pointvalue  NUMERIC DEFAULT 1
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
    UNIQUE (id, theme_id)
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
    created_at               TIMESTAMP DEFAULT NOW(),
    updated_at               TIMESTAMP DEFAULT NOW(),
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
