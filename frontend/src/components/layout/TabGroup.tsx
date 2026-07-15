import * as React from 'react';
import Box from '@mui/material/Box';
import TabContext from '@mui/lab/TabContext';
import TabPanel from '@mui/lab/TabPanel';
import Registration from './Registration';
import Login from './Login';

function TabGroup() {
    const [value, setValue] = React.useState('1');

    return (
        <Box sx={{ width: '100%', typography: 'body1' }}>
            <TabContext value={value}>
                <TabPanel value="1"><Registration setValue={setValue} /></TabPanel>
                <TabPanel value="2"><Login setValue={setValue} /></TabPanel>
            </TabContext>
        </Box>
    );
}

export default TabGroup;
