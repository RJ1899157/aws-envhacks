# AirForce

## Visualise the way pollution spreads through your house

## Deployed app

Live demo: https://main.d2iwbt8w1yhn6o.amplifyapp.com/

AirForce is an interactive home-design and ventilation simulator. It helps people
understand how the layout of a home, its doors and windows, everyday activities,
and ventilation devices affect indoor air quality.

Most people know that smoke, cooking, incense, and poor ventilation can make
indoor air unhealthy. What is difficult is seeing **where the problem is**, why
it happens, and what change would actually help. AirForce turns that invisible
problem into something people can explore visually.

The user can create a home from scratch, start with a sample design, or inspect
a single room. They then place openings, furniture, fans, purifiers, and common
pollution sources such as cooking, incense, smoking, and bathroom-related
sources. AirForce simulates the resulting airflow and PM2.5 movement, identifies
weakly ventilated rooms, and ranks practical actions that can improve the design.

## Why this matters

Indoor air quality is not determined by a purifier alone. It depends on a
combination of:

- the position and size of windows and doors;
- wind direction and speed outside the building;
- the surrounding environment, such as open, suburban, or dense urban areas;
- temperature differences that create stack ventilation;
- the location and strength of pollution sources;
- exhaust fans, range hoods, ceiling fans, and air purifiers; and
- how air moves between rooms.

AirForce brings these factors together in one visual workflow. Instead of
giving generic advice such as “open a window,” it can answer questions such as:

- Which room is accumulating pollution?
- Is a window acting as an inlet or an outlet in the current wind?
- Would opening another window create cross-ventilation?
- Should a cooking source be moved closer to an exhaust fan?
- Would a purifier help the affected room?
- Which low-effort change gives the biggest improvement?

## How the product works

### 1. Choose a starting point

The user can:

- make a custom house;
- open a prepared sample house; or
- create a single room for a quick experiment.

### 2. Describe the home

For a custom home, the user provides the basic context of the space, including
the floor/layout, surroundings, number of rooms, and bathrooms.

### 3. Build the layout

The user draws or edits walls, adds rooms, and places:

- doors and windows;
- furniture and other objects;
- exhaust fans, range hoods, ceiling fans, pedestal fans, air conditioners,
  and purifiers; and
- pollution sources such as cooking/frying, incense, or smoking.

Windows and doors can be opened, closed, resized, and tagged according to their
intended ventilation role.

### 4. Run the simulation

AirForce evaluates the design using the selected outdoor conditions and the
objects in the scene. The results show room-level PM2.5, air changes per hour,
airflow between rooms, source impact, and ventilation warnings.

### 5. Compare improvements

The recommendation engine generates possible changes, evaluates them against
the same home, and ranks the changes by their effect and effort. Users can
compare the baseline with a proposed design before deciding what to change.

## What is simulated

AirForce uses a lightweight, browser-friendly model rather than a heavyweight
CFD package. This keeps the interaction fast enough for an interactive
design tool while still exposing the main factors that affect a household.

The simulation includes:

- wind-driven flow through openings;
- single-sided ventilation;
- cross-ventilation through inlet and outlet openings;
- buoyancy/stack effects caused by indoor and outdoor temperature differences;
- background infiltration;
- exhaust and mechanical airflow;
- purifier clean-air delivery;
- room volumes and air changes per hour;
- PM2.5 emitted by scheduled sources; and
- pollutant movement through the connected room network.

The recommendation system evaluates individual actions and useful combinations,
removes changes that have almost no effect, and separates improvements from
actions that would make the selected objective worse. A secondary voxel-based
check can verify whether the simplified network model agrees with the direction
of the predicted change.

## Main features

- 2D floor-plan editing and 3D walkthrough
- Snap-to-angle wall drawing and editable room geometry
- Drag-and-drop asset library
- Doors and windows that attach to walls
- Opening size, open fraction, and ventilation-role controls
- Furniture, fans, exhausts, purifiers, and pollution sources
- Outdoor PM2.5 and weather input, including optional live conditions
- Room-by-room air-quality and ventilation results
- Ranked recommendations with before/after values
- Scenario comparison and snapshots
- Project import/export
- 3D model and 2D document export
- Keyboard shortcuts and a command palette
- Performance overlay for monitoring the 3D scene

## Technical architecture

```text
                         Optional live conditions
                         Open-Meteo air quality/weather
                                      |
                                      v
+------------------+       +-----------------------+
| React web app    | ----> | Optional AWS HTTP API |
| 2D/3D editor    |       | /conditions           |
+--------+---------+       +-----------+-----------+
         |                             |
         |                             v
         |                    Lambda + DynamoDB cache
         |
         v
+---------------------------+
| Local simulation engine   |
| ventilation + PM2.5      |
| network + voxel checking |
+-------------+-------------+
              |
              v
   Results, warnings, and ranked actions
```

The core design and simulation run in the browser. This makes the app useful
even without a backend and keeps the editing loop responsive. The optional
serverless endpoint provides live outdoor PM2.5 and weather data and caches
location-based readings so the external service is not called unnecessarily.

Recommendations are based on the simulation and ranking engine. They are not a
substitute for professional indoor-air-quality or medical advice.

## Technology stack

### Frontend

- **React 18** and **TypeScript** for the application UI
- **Vite** for development and production builds
- **Three.js**, **React Three Fiber**, and **Drei** for the 3D scene
- **Tailwind CSS** for styling
- **Zustand** and **Immer** for predictable application state updates
- **Zod** for validating project and scene data
- **IndexedDB** for local snapshots and browser persistence
- **Vitest** and **Playwright** for unit and end-to-end testing

### Simulation

The simulation code is written in TypeScript and is divided into focused
modules for:

- room and opening geometry;
- ventilation and airflow;
- pollutant sources and devices;
- room-network mixing;
- voxel-based verification;
- scenario generation and ranking; and
- result reports and visual explanations.

### AWS and external services

The optional backend is deployed with AWS SAM and uses:

- **Amazon API Gateway HTTP API** for the public endpoints
- **AWS Lambda** with Python 3.12 for the serverless backend
- **Amazon DynamoDB** for short-lived response caching
- **Amazon CloudWatch Logs** for backend request logs
- **Open-Meteo Air Quality API** for outdoor PM2.5
- **Open-Meteo Forecast API** for temperature, wind speed, and wind direction

No model-inference service is required for the core simulation or
recommendations.

## Repository structure

```text
src/
  app/                 Application entry point and top-level UI
  builder/             2D/3D floor-plan editor and object placement
  core/                Shared scene schema, geometry, and domain types
  io/                  Project import/export and file formats
  services/            Optional backend and live-condition clients
  simulation/          Ventilation, PM2.5, voxel, and ranking logic
  store/               Application and scenario state
  ui/                  Panels, controls, results, and overlays

infra/
  template.yaml        AWS SAM infrastructure definition
  functions/           Lambda handlers
  tests/               Backend tests

e2e/                   Browser-level tests
public/                Assets and showcase designs
test-designs/          Reproducible sample projects
```

## Run the project locally

### Prerequisites

- Node.js 18 or newer
- npm

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Then open the local URL shown by Vite.

The app can run without an AWS backend. To enable live outdoor conditions,
set `VITE_API_BASE_URL` to the base URL of the deployed HTTP API before
starting Vite:

```bash
VITE_API_BASE_URL=https://your-api-id.execute-api.your-region.amazonaws.com npm run dev
```

On Windows PowerShell:

```powershell
$env:VITE_API_BASE_URL = "https://your-api-id.execute-api.your-region.amazonaws.com"
npm run dev
```

## Useful commands

```bash
npm run build       # Type-check and create a production build
npm test            # Run unit tests
npm run test:e2e    # Run Playwright browser tests
npm run lint        # Run ESLint
npm run format      # Format frontend source files
```

## Backend deployment

The backend infrastructure is defined in [infra/template.yaml](infra/template.yaml).
It is intentionally small: the frontend can still be used offline, while the
deployed API adds live outdoor readings and caching.

With the AWS SAM CLI and AWS credentials configured:

```bash
cd infra
sam validate --lint
sam build
sam deploy --guided
```

After deployment, set the API URL as `VITE_API_BASE_URL` when building or
running the frontend. CORS origins should be configured for the frontend URL.

## Design decisions

### Fast feedback over heavyweight computation

The tool is meant to help users experiment with a home layout. A result that
arrives while the user is still designing is more useful here than a highly
detailed simulation that takes several minutes for every change.

### Explainable recommendations

Every recommendation keeps the inputs that produced it: the affected rooms,
before/after PM2.5, air changes, airflow paths, and the action itself. This
makes the result inspectable instead of presenting an unexplained score.

### Offline-first core

The home editor and simulation do not depend on a network request. Live
conditions are an enhancement, not a requirement. This is useful for demos,
slow networks, and privacy-conscious users.

## Current limitations

- The ventilation model is an engineering approximation, not a full CFD solver.
- Complex overlapping wall corners and openings can produce visual artifacts.
- Multi-touch editing on mobile is still being improved.
- Live conditions depend on the availability of the Open-Meteo services.
- Results should be treated as design guidance, not a certified air-quality
  measurement.

## Hackathon outcome

AirForce connects a familiar activity—designing a home—with a problem that is
usually invisible. A user can go from an empty room to a measurable answer:

> “This source is affecting this room because the air is not leaving efficiently.
> Here are the changes that improve it, and here is how much each change helps.”

That is the purpose of the project: make better ventilation understandable,
visual, and actionable for ordinary households.
