import unittest

from simulation import simulate_detector_data


class DebugSimulationSmokeTest(unittest.TestCase):
    def test_simulated_series_emits_start_end(self) -> None:
        grid_x = 4
        grid_y = 4
        total_frames = grid_x * grid_y
        messages = list(simulate_detector_data(grid_x, grid_y, num_frames=total_frames, acquisition_rate=1000.0))

        self.assertTrue(messages)
        self.assertEqual(messages[0]['type'], 'start')
        self.assertEqual(messages[-1]['type'], 'end')

        image_messages = [msg for msg in messages if msg['type'] == 'image']
        self.assertEqual(len(image_messages), total_frames)


if __name__ == '__main__':
    unittest.main()
