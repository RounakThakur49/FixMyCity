import { useState } from 'react';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';

const westBengalCities: readonly string[] = [
    'Asansol',
    'Baharampur',
    'Bardhaman',
    'Darjeeling',
    'Durgapur',
    'Howrah',
    'Jalpaiguri',
    'Kharagpur',
    'Kolkata',
    'Malda',
    'Siliguri'
];
interface WestBengalCitySelectProps {
    /** Callback function to pass the selected city back to a parent form/component */
    onCityChange?: (city: string | null) => void;
    /** Custom label for the input field, defaults to "Select City (Assam)" */
    label?: string;
}

export default function WestBengalCitySelect({ onCityChange, label }: WestBengalCitySelectProps) {
    const [value, setValue] = useState<string | null>(null);

    return (
        <Autocomplete
            id="WestBengal-city-select"
            sx={{ width: "100%" }}
            options={westBengalCities}
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