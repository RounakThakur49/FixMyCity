import { useState } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';

// List of principal cities and major towns in Bihar
const biharCities: readonly string[] = [
  'Arrah',
  'Begusarai',
  'Bettiah',
  'Bhagalpur',
  'Bihar Sharif',
  'Buxar',
  'Darbhanga',
  'Gaya',
  'Gopalganj',
  'Hajipur',
  'Katihar',
  'Munger',
  'Muzaffarpur',
  'Patna',
  'Purnia',
  'Saharsa',
  'Samastipur',
  'Sasaram',
  'Sitamarhi',
  'Siwan'
];

interface BiharCitySelectProps {
  /** Callback function to pass the selected city back to a parent form/component */
  onCityChange?: (city: string | null) => void;
  /** Custom label for the input field, defaults to "Select City (Bihar)" */
  label?: string;
}

export default function BiharCitySelect({ onCityChange, label }: BiharCitySelectProps) {
  const [value, setValue] = useState<string | null>(null);

  return (
    <Autocomplete
      id="bihar-city-select"
      sx={{ width: "100%" }}
      options={biharCities}
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
          label={label || "Select City (Bihar)"}
          variant="outlined"
          placeholder="Search Bihar cities..."
        />
      )}
    />
  );
}