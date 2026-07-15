import { useState } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';

// List of principal cities and major towns in Assam
const chhattisgarhCities: readonly string[] = [
  'Ambikapur',
  'Bhilai',
  'Bilaspur',
  'Dhamtari',
  'Durg',
  'Jagdalpur',
  'Korba',
  'Mahasamund',
  'Raigarh',
  'Raipur',
  'Rajnandgaon'
];

interface ChhattisgarhCitySelectProps {
  /** Callback function to pass the selected city back to a parent form/component */
  onCityChange?: (city: string | null) => void;
  /** Custom label for the input field, defaults to "Select City (Assam)" */
  label?: string;
}

export default function ChhattisgarhCitySelect({ onCityChange, label }: ChhattisgarhCitySelectProps) {
  const [value, setValue] = useState<string | null>(null);

  return (
    <Autocomplete
      id="chhattisgarh      -city-select"
      sx={{ width: "100%" }}
      options={chhattisgarhCities}
      autoHighlight
      value={value}
      onChange={(event, newValue) => {
        setValue(newValue);
        if (onCityChange) {
          onCityChange(newValue);
        }
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label || "Select City (Assam)"}
          variant="outlined"
          placeholder="Search Assam cities..."
        />
      )}
    />
  );
}