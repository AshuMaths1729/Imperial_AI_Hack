"""Trusted demo simulation written to the §3.3 contract: heavy-ball / momentum dynamics.

Reproduces the Phase-1 prototype (`legacy.run_heavy_ball_sim`): same semi-implicit Euler step,
same three series. Available immediately as `sim_heavy_ball`, no LLM needed.
"""

from __future__ import annotations

SEED_ID = "sim_heavy_ball"

HEAVY_BALL_CODE = '''\
"""Heavy-ball (momentum) dynamics on a slightly non-quadratic loss.

theta'' = -gamma * theta' - eta * (theta + 0.15 sin(3 theta)),  theta(0) = theta0.
"""
import math

PARAMS = {
    "gamma": {"min": 0.05, "max": 2.0, "default": 0.35, "step": 0.05,
              "unit": "", "label": "Friction gamma"},
    "eta": {"min": 0.5, "max": 6.0, "default": 2.4, "step": 0.1,
            "unit": "", "label": "Step size eta"},
    "theta0": {"min": 0.2, "max": 3.0, "default": 1.8, "step": 0.1,
               "unit": "", "label": "Initial parameter theta0"},
}

DT = 0.08
STEPS = 180


def simulate(gamma, eta, theta0):
    theta = [0.0] * STEPS
    vel = [0.0] * STEPS
    energy = [0.0] * STEPS
    envelope = [0.0] * STEPS
    theta[0] = theta0
    energy[0] = round(0.5 * theta0 ** 2, 4)
    envelope[0] = round(theta0, 4)
    for i in range(1, STEPS):
        t = i * DT
        grad = theta[i - 1] + 0.15 * math.sin(3.0 * theta[i - 1])
        acc = -gamma * vel[i - 1] - eta * grad
        vel[i] = vel[i - 1] + DT * acc
        theta[i] = round(theta[i - 1] + DT * vel[i], 4)
        energy[i] = round(0.5 * theta[i] ** 2 + 0.5 * vel[i] ** 2 / max(eta, 0.1), 4)
        envelope[i] = round(theta0 * math.exp(-0.5 * gamma * t), 4)
    xs = [round(i * DT, 2) for i in range(STEPS)]
    return {
        "title": "Heavy-ball dynamics",
        "x_label": "time t",
        "y_label": "value",
        "series": [
            {"name": "Parameter Trajectory \u03b8(t)", "x": xs, "y": theta},
            {"name": "Lyapunov Loss Energy E(t)", "x": xs, "y": energy},
            {"name": "Theoretical Damping Envelope", "x": xs, "y": envelope},
        ],
    }
'''

SEED_META = {
    "title": "Heavy-ball momentum dynamics",
    "explanation": (
        "Momentum (heavy-ball) gradient descent as a damped oscillator: friction gamma damps the "
        "trajectory, step size eta sets the frequency, and the envelope shows the predicted "
        "exponential decay exp(-gamma t / 2)."
    ),
    "assumptions": [
        "1-D loss with gradient theta + 0.15 sin(3 theta) (slightly non-quadratic)",
        "semi-implicit Euler with dt = 0.08, 180 steps",
    ],
    "equation_latex": r"\ddot\theta + \gamma\dot\theta + \eta\,\nabla L(\theta) = 0",
}
