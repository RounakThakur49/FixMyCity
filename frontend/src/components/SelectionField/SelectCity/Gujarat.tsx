import { useState } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';

// List of principal cities and major towns in Assam
const gujaratCities: readonly string[] = [
    'Ahmedabad',
    'Anand',
    'Bharuch',
    'Bhavnagar',
    'Bhuj',
    'Gandhidham',
    'Gandhinagar',
    'Jamnagar',
    'Junagadh',
    'Morbi',
    'Nadiad',
    'Navsari',
    'Porbandar',
    'Rajkot',
    'Surat',
    'Surendranagar',
    'Vadodara',
    'Valsad'
];
interface GujaratCitySelectProps {
    /** Callback function to pass the selected city back to a parent form/component */
    onCityChange?: (city: string | null) => void;
    /** Custom label for the input field, defaults to "Select City (Assam)" */
    label?: string;
}

export default function GujaratCitySelect({ onCityChange, label }: GujaratCitySelectProps) {
    const [value, setValue] = useState<string | null>(null);

    return (
        <Autocomplete
            id="Gujarat-city-select"
            sx={{ width: "100%" }}
            options={gujaratCities}
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