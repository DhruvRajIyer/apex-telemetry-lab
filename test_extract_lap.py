import unittest

import numpy as np

from extract_lap import wheel_loads, resample_channel, estimate_motion, brake_model, select_team_laps, longest_unchanged_span, corner_distance


class LoadModelTests(unittest.TestCase):
    def test_load_is_conserved(self):
        for lateral in (-6, 0, 6):
            for longitudinal in (-6, 0, 3):
                loads = wheel_loads(lateral, longitudinal, 5000)
                self.assertAlmostEqual(sum(loads), 800 * 9.80665 + 5000)
                self.assertTrue(all(value >= 0 for value in loads))

    def test_positive_left_turn_loads_right_wheels(self):
        fl, fr, rl, rr = wheel_loads(2, 0, 5000)
        self.assertGreater(fr, fl)
        self.assertGreater(rr, rl)

    def test_braking_moves_load_to_front(self):
        coast = wheel_loads(0, 0, 5000)
        braking = wheel_loads(0, -3, 5000)
        self.assertGreater(sum(braking[:2]), sum(coast[:2]))
        self.assertLess(sum(braking[2:]), sum(coast[2:]))


class EstimationTests(unittest.TestCase):
    def test_native_channels_hold_discrete_values(self):
        t = np.array([0.0, 0.4, 0.8, 1.2])
        self.assertEqual(resample_channel(t, [0, 1, 0, 1], [0.39], discrete=True)[0], 0)
        self.assertEqual(resample_channel(t, [0, 1, 0, 1], [0.4], discrete=True)[0], 1)
        self.assertAlmostEqual(resample_channel(t, [0, 4, 8, 12], [0.2])[0], 2)

    def test_rejects_uncovered_missing_and_gapped_data(self):
        for t, values, target in [([0, 1], [0, np.nan], [0.5]), ([0, 1], [1, 2], [-0.1]),
                                  ([0, 3], [1, 2], [1]), ([0, 0], [1, 2], [0])]:
            with self.assertRaises(ValueError):
                resample_channel(t, values, target)

    def test_straight_acceleration_and_circle(self):
        t = np.arange(0, 20, 0.1)
        v = 20 + 2 * t
        lateral, longitudinal, _ = estimate_motion(t, v, 20 * t + t * t, np.zeros_like(t))
        np.testing.assert_allclose(longitudinal[30:-30], 2 / 9.80665, atol=1e-8)
        np.testing.assert_allclose(lateral, 0, atol=1e-8)
        angle = 0.2 * t
        lateral, longitudinal, _ = estimate_motion(t, np.full_like(t, 20), 100 * np.cos(angle), 100 * np.sin(angle))
        np.testing.assert_allclose(lateral[30:-30], 4 / 9.80665, rtol=0.02)
        np.testing.assert_allclose(longitudinal, 0, atol=1e-8)

    def test_brake_energy_uses_previous_interval_state(self):
        _, energy = brake_model(np.array([0., 1., 2.]), np.array([30., 20., 10.]), np.array([0, 1, 0]), 25, drag_cda=0)
        self.assertEqual(energy[1], 0)
        self.assertAlmostEqual(energy[2], 0.5 * 800 * (20 ** 2 - 10 ** 2))

    def test_cooling_is_stable_and_front_brakes_heat_more(self):
        temperatures, energy = brake_model(np.array([0., 1000.]), np.array([30., 30.]), np.array([0, 0]), 25)
        self.assertTrue(np.all(temperatures >= 25))
        self.assertTrue(np.all(temperatures[-1] < temperatures[0]))
        np.testing.assert_array_equal(energy, 0)
        temperatures, energy = brake_model(np.array([0., 0.1]), np.array([70., 60.]), np.array([1, 0]), 25)
        self.assertGreater(temperatures[-1, 0], temperatures[-1, 2])
        self.assertGreater(temperatures[-1, 0], 350)
        self.assertGreater(energy[-1], 0)

    def test_frozen_source_detection_ignores_padding(self):
        times = np.arange(-10, 11, dtype=float)
        self.assertEqual(longest_unchanged_span(times, np.ones((21, 5)), 5), 5)
        self.assertEqual(longest_unchanged_span(times, np.arange(21)[:, None], 5), 0)
        values = np.ones((21, 5))
        values[10:] = np.arange(11)[:, None]
        self.assertEqual(longest_unchanged_span(times, values, 5), 0)

    def test_exact_cooling_matches_analytic_solution(self):
        temperatures, _ = brake_model(np.array([0., 7.]), np.array([20., 20.]), np.array([0, 0]), 23)
        expected = 23 + (350 - 23) * np.exp(-(35 + 1.1 * 20) * 7 / 2000)
        np.testing.assert_allclose(temperatures[-1], expected)

    def test_corner_distance_uses_selected_lap_coordinates(self):
        self.assertEqual(corner_distance([0, 5, 10], [0, 4, 0], [0, 8, 16], 5.1, 4.1), 8)

    def test_four_fastest_distinct_teams(self):
        import pandas as pd
        laps = pd.DataFrame({"Team": ["A", "A", "B", "C", "D", "E"],
                             "Driver": ["A1", "A2", "B1", "C1", "D1", "E1"],
                             "LapTime": pd.to_timedelta([70, 71, 72, 73, 74, 75], unit="s"),
                             "IsPersonalBest": [True] * 6})
        self.assertEqual(list(select_team_laps(laps)["Driver"]), ["A1", "B1", "C1", "D1"])


if __name__ == "__main__":
    unittest.main()
